import { randomUUID } from 'node:crypto';
import { type ChildSessionIdentity, isSameChildSessionIdentity } from '@shared/builtinAgents';
import type {
  AgentControlContext,
  AgentControlDismissRequest,
  AgentControlListRequest,
  AgentControlMessageRequest,
  AgentControlRunTargetRequest,
  AgentControlSendRequest,
  AgentControlSpawnRequest,
  AgentControlWaitRequest,
  AgentInstanceStatus,
  AgentListReceipt,
  AgentMode,
  AgentRunGate,
  AgentRunReport,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentSendReceipt,
  AgentServiceResult,
  AgentSpawnReceipt,
  AgentWaitReceipt,
  AgentWorkerEvent,
} from '@shared/types/agent';

interface RuntimeResult {
  ok: boolean;
  error?: string;
}

export interface AgentRuntimeSpawnInput {
  context: AgentControlContext;
  agentId: string;
  mode: AgentMode;
  name?: string;
  description: string;
  agentType?: string;
  model?: string;
  thinking?: AgentControlSpawnRequest['thinking'];
}

export interface AgentRuntimeRunInput {
  context: AgentControlContext;
  identity: ChildSessionIdentity;
  agentId: string;
  runId: string;
  prompt: string;
  schema?: unknown;
  gate?: AgentRunGate;
  signal?: AbortSignal;
}

export interface AgentServiceRuntime {
  spawn(input: AgentRuntimeSpawnInput): Promise<ChildSessionIdentity>;
  prompt(input: AgentRuntimeRunInput): Promise<RuntimeResult>;
  steer(input: Omit<AgentRuntimeRunInput, 'schema' | 'gate'>): Promise<RuntimeResult>;
  stop(input: {
    context: AgentControlContext;
    identity: ChildSessionIdentity;
    agentId: string;
    runId: string;
  }): Promise<RuntimeResult>;
  dismiss(input: {
    context: AgentControlContext;
    identity: ChildSessionIdentity;
    agentId: string;
  }): Promise<RuntimeResult>;
  validate?(
    input: AgentRuntimeRunInput & { text?: string }
  ): Promise<RuntimeResult & { value?: unknown }>;
}

export interface AgentServiceContract {
  spawn(request: AgentControlSpawnRequest): Promise<AgentServiceResult<AgentSpawnReceipt>>;
  send(request: AgentControlSendRequest): Promise<AgentServiceResult<AgentSendReceipt>>;
  stop(request: AgentControlRunTargetRequest): Promise<AgentServiceResult<AgentRunSnapshot>>;
  dismiss(request: AgentControlDismissRequest): Promise<AgentServiceResult<{ agentId: string }>>;
  report(request: AgentControlRunTargetRequest): Promise<AgentServiceResult<AgentRunReport>>;
  wait(
    request: AgentControlWaitRequest,
    signal?: AbortSignal
  ): Promise<AgentServiceResult<AgentWaitReceipt>>;
  list(request: AgentControlListRequest): Promise<AgentServiceResult<AgentListReceipt>>;
  message(request: AgentControlMessageRequest): Promise<AgentServiceResult<AgentSendReceipt>>;
}

interface AgentRecord {
  context: AgentControlContext;
  agentId: string;
  mode: AgentMode;
  identity: ChildSessionIdentity;
  status: AgentInstanceStatus;
  activeRunId?: string;
  queuedRunIds: string[];
}

interface RunRecord {
  context: AgentControlContext;
  agentId: string;
  runId: string;
  mode: AgentMode;
  status: AgentRunStatus;
  prompt: string;
  schema?: unknown;
  gate?: AgentRunGate;
  text?: string;
  value?: unknown;
  error?: string;
  usageByMessage: Map<number, { input: number; output: number }>;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  validationAbort?: AbortController;
}

interface Waiter {
  runIds: readonly string[];
  until: 'all' | 'any';
  settle(interrupted: boolean, timedOut: boolean): void;
}

export interface AgentServiceOptions {
  runtime: AgentServiceRuntime;
  randomUuid?: () => string;
  now?: () => number;
  allowedModes?: (context: AgentControlContext) => ReadonlySet<AgentMode>;
}

const TERMINAL_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);

function failure<T>(
  code: Extract<AgentServiceResult<T>, { ok: false }>['code'],
  error: string
): AgentServiceResult<T> {
  return { ok: false, code, error };
}

function projectedText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined;
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== 'assistant') return undefined;
  if (typeof value.content === 'string') return value.content;
  if (!Array.isArray(value.content)) return undefined;
  const text = value.content
    .map((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return '';
      const candidate = part as { type?: unknown; text?: unknown };
      return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : '';
    })
    .join('');
  return text || undefined;
}

function promptForRun(run: RunRecord): string {
  if (run.schema === undefined) return run.prompt;
  return `${run.prompt}\n\nReturn exactly one JSON value matching this schema:\n${JSON.stringify(
    run.schema
  )}`;
}

export class AgentService implements AgentServiceContract {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly waiters = new Set<Waiter>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly randomUuid: () => string;
  private readonly now: () => number;

  constructor(private readonly options: AgentServiceOptions) {
    this.randomUuid = options.randomUuid ?? randomUUID;
    this.now = options.now ?? Date.now;
  }

  /** Main 从权威 child metadata 恢复持久 coworker；task 与非 agent-tool child 不得调用。 */
  adoptCoworker(context: AgentControlContext, identity: ChildSessionIdentity): boolean {
    if (context.owner.kind !== 'chatSession' || identity.instanceId.length === 0) return false;
    const existing = this.agents.get(identity.instanceId);
    if (existing) {
      if (!this.sameOwner(existing.context, context) || existing.mode !== 'coworker') return false;
      existing.identity = identity;
      existing.status = existing.activeRunId ? 'active' : 'ready';
      return true;
    }
    this.agents.set(identity.instanceId, {
      context,
      agentId: identity.instanceId,
      mode: 'coworker',
      identity,
      status: 'ready',
      queuedRunIds: [],
    });
    return true;
  }

  spawn(request: AgentControlSpawnRequest): Promise<AgentServiceResult<AgentSpawnReceipt>> {
    return this.serial(request.context.owner.ownerId, async () => {
      const invalid = this.validateContext<AgentSpawnReceipt>(request.context);
      if (invalid) return invalid;
      const mode = request.mode ?? 'task';
      if (!this.allowedModes(request.context).has(mode)) {
        return failure('mode-disabled', `Agent mode is disabled: ${mode}`);
      }
      if (!request.requestId || !request.description.trim() || !request.prompt.trim()) {
        return failure('invalid-state', 'requestId, description and prompt are required.');
      }
      const agentId = this.randomUuid();
      const runId = this.randomUuid();
      let identity: ChildSessionIdentity;
      try {
        identity = await this.options.runtime.spawn({
          context: request.context,
          agentId,
          mode,
          ...(request.name?.trim() ? { name: request.name.trim() } : {}),
          description: request.description,
          ...(request.agentType ? { agentType: request.agentType } : {}),
          ...(request.model ? { model: request.model } : {}),
          ...(request.thinking ? { thinking: request.thinking } : {}),
        });
      } catch (error) {
        return failure(
          'runtime-unavailable',
          error instanceof Error ? error.message : String(error)
        );
      }
      const agent: AgentRecord = {
        context: request.context,
        agentId,
        mode,
        identity,
        status: 'ready',
        queuedRunIds: [],
      };
      const run = this.createRun(agent, runId, request.prompt, request.schema, request.gate);
      this.agents.set(agentId, agent);
      this.runs.set(runId, run);
      const started = await this.startRun(agent, run);
      if (!started.ok) {
        this.agents.delete(agentId);
        this.runs.delete(runId);
        await this.options.runtime.dismiss({
          context: request.context,
          identity,
          agentId,
        });
        return started;
      }
      return { ok: true, value: { agentId, runId, mode, status: 'running' } };
    });
  }

  send(request: AgentControlSendRequest): Promise<AgentServiceResult<AgentSendReceipt>> {
    return this.serial(request.context.owner.ownerId, async () => {
      const agent = this.ownedAgent(request.context, request.agentId);
      if (!agent.ok) return agent;
      if (!request.requestId || !request.message.trim()) {
        return failure('invalid-state', 'requestId and message are required.');
      }
      if (agent.value.status === 'closed') {
        return failure('invalid-state', 'Agent is dismissed.');
      }
      const active = agent.value.activeRunId ? this.runs.get(agent.value.activeRunId) : undefined;
      if (request.expectedRunId && request.expectedRunId !== active?.runId) {
        return failure('run-mismatch', 'The active Run changed before delivery.');
      }
      const delivery = request.delivery ?? 'auto';
      if (active && delivery !== 'next') {
        if (active.status === 'validating') {
          return failure('invalid-state', 'The active Run is validating and cannot be steered.');
        }
        const sent = await this.options.runtime.steer({
          context: request.context,
          identity: agent.value.identity,
          agentId: agent.value.agentId,
          runId: active.runId,
          prompt: request.message,
        });
        if (!sent.ok) return failure('runtime-unavailable', sent.error ?? 'Steer failed.');
        if (TERMINAL_RUN_STATUSES.has(active.status) || agent.value.activeRunId !== active.runId) {
          return failure('invalid-state', 'The active Run ended while steer was being delivered.');
        }
        return {
          ok: true,
          value: {
            agentId: agent.value.agentId,
            runId: active.runId,
            delivery: 'steer',
            status: 'running',
          },
        };
      }
      if (delivery === 'steer') {
        return failure('invalid-state', 'There is no active Run to steer.');
      }
      if (agent.value.mode !== 'coworker') {
        return failure('invalid-state', 'A task Agent cannot start another Run.');
      }
      const runId = this.randomUuid();
      const run = this.createRun(agent.value, runId, request.message, request.schema, request.gate);
      this.runs.set(runId, run);
      if (active) {
        agent.value.queuedRunIds.push(runId);
        return {
          ok: true,
          value: {
            agentId: agent.value.agentId,
            runId,
            delivery: 'next',
            status: 'queued',
          },
        };
      }
      const started = await this.startRun(agent.value, run);
      if (!started.ok) return started;
      return {
        ok: true,
        value: {
          agentId: agent.value.agentId,
          runId,
          delivery: 'next',
          status: 'running',
        },
      };
    });
  }

  stop(request: AgentControlRunTargetRequest): Promise<AgentServiceResult<AgentRunSnapshot>> {
    return this.serial(request.context.owner.ownerId, async () => {
      const run = this.ownedRun(request.context, request.runId);
      if (!run.ok) return run;
      if (TERMINAL_RUN_STATUSES.has(run.value.status)) {
        return { ok: true, value: this.snapshot(run.value) };
      }
      const agent = this.agents.get(run.value.agentId);
      if (!agent) return failure('not-found', 'Agent was not found.');
      if (run.value.status === 'queued') {
        agent.queuedRunIds = agent.queuedRunIds.filter((id) => id !== run.value.runId);
      } else if (run.value.status !== 'validating') {
        const stopped = await this.options.runtime.stop({
          context: request.context,
          identity: agent.identity,
          agentId: agent.agentId,
          runId: run.value.runId,
        });
        if (!stopped.ok) return failure('runtime-unavailable', stopped.error ?? 'Stop failed.');
      } else {
        run.value.validationAbort?.abort();
      }
      this.finishRun(run.value, 'cancelled');
      if (agent.mode === 'task') {
        this.closeTask(agent);
      } else if (agent.activeRunId === run.value.runId) {
        agent.activeRunId = undefined;
        agent.status = 'ready';
        await this.startNext(agent);
      }
      return { ok: true, value: this.snapshot(run.value) };
    });
  }

  dismiss(request: AgentControlDismissRequest): Promise<AgentServiceResult<{ agentId: string }>> {
    return this.serial(request.context.owner.ownerId, async () => {
      const agent = this.ownedAgent(request.context, request.agentId);
      if (!agent.ok) return agent;
      if (agent.value.status === 'closed') {
        return { ok: true, value: { agentId: agent.value.agentId } };
      }
      const dismissed = await this.options.runtime.dismiss({
        context: request.context,
        identity: agent.value.identity,
        agentId: agent.value.agentId,
      });
      if (!dismissed.ok) {
        return failure('runtime-unavailable', dismissed.error ?? 'Dismiss failed.');
      }
      for (const run of this.runs.values()) {
        if (run.agentId === agent.value.agentId && !TERMINAL_RUN_STATUSES.has(run.status)) {
          run.validationAbort?.abort();
          this.finishRun(run, 'cancelled');
        }
      }
      agent.value.activeRunId = undefined;
      agent.value.queuedRunIds = [];
      agent.value.status = 'closed';
      return { ok: true, value: { agentId: agent.value.agentId } };
    });
  }

  async report(request: AgentControlRunTargetRequest): Promise<AgentServiceResult<AgentRunReport>> {
    const run = this.ownedRun(request.context, request.runId);
    if (!run.ok) return run;
    if (!TERMINAL_RUN_STATUSES.has(run.value.status)) {
      return failure('invalid-state', 'Run has not reached an immutable result.');
    }
    return {
      ok: true,
      value: {
        run: this.snapshot(run.value),
        ...(run.value.text !== undefined ? { text: run.value.text } : {}),
        ...(run.value.value !== undefined ? { value: run.value.value } : {}),
        ...(run.value.error !== undefined ? { error: run.value.error } : {}),
        ...(this.runUsage(run.value) ? { usage: this.runUsage(run.value) } : {}),
      },
    };
  }

  async list(request: AgentControlListRequest): Promise<AgentServiceResult<AgentListReceipt>> {
    const invalid = this.validateContext<AgentListReceipt>(request.context);
    if (invalid) return invalid;
    const visible = [...this.agents.values()]
      .filter((agent) => this.sameOwner(agent.context, request.context))
      .filter((agent) => request.status === undefined || agent.status === request.status)
      .sort((left, right) => left.agentId.localeCompare(right.agentId));
    const start = request.cursor
      ? Math.max(0, visible.findIndex((agent) => agent.agentId === request.cursor) + 1)
      : 0;
    const limit = Math.min(100, Math.max(1, request.limit ?? 20));
    const page = visible.slice(start, start + limit);
    return {
      ok: true,
      value: {
        agents: page.map((agent) => {
          const latest = [...this.runs.values()]
            .filter((run) => run.agentId === agent.agentId)
            .sort((left, right) => right.createdAt - left.createdAt)[0];
          return {
            agentId: agent.agentId,
            mode: agent.mode,
            status: agent.status,
            ...(agent.activeRunId ? { activeRunId: agent.activeRunId } : {}),
            ...(latest ? { latestRun: this.snapshot(latest) } : {}),
          };
        }),
        ...(start + page.length < visible.length && page.length > 0
          ? { nextCursor: page.at(-1)!.agentId }
          : {}),
      },
    };
  }

  message(request: AgentControlMessageRequest): Promise<AgentServiceResult<AgentSendReceipt>> {
    return this.send({
      context: request.context,
      requestId: request.requestId,
      agentId: request.to,
      message: request.text,
      delivery: 'auto',
    });
  }

  async wait(
    request: AgentControlWaitRequest,
    signal?: AbortSignal
  ): Promise<AgentServiceResult<AgentWaitReceipt>> {
    const invalid = this.validateContext<AgentWaitReceipt>(request.context);
    if (invalid) return invalid;
    if (request.runIds.length === 0 || new Set(request.runIds).size !== request.runIds.length) {
      return failure('invalid-state', 'wait requires unique Run ids.');
    }
    for (const runId of request.runIds) {
      const owned = this.ownedRun(request.context, runId);
      if (!owned.ok) return owned;
    }
    const until = request.until ?? 'all';
    const ready = () => this.waitSatisfied(request.runIds, until);
    if (ready()) return { ok: true, value: this.waitReceipt(request.runIds, false, false) };
    if (signal?.aborted) {
      return { ok: true, value: this.waitReceipt(request.runIds, true, false) };
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = {
        runIds: [...request.runIds],
        until,
        settle: (interrupted, timedOut) => {
          cleanup();
          resolve({
            ok: true,
            value: this.waitReceipt(request.runIds, interrupted, timedOut),
          });
        },
      };
      const onAbort = () => waiter.settle(true, false);
      const cleanup = () => {
        this.waiters.delete(waiter);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.waiters.add(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (request.timeoutMs !== undefined) {
        timer = setTimeout(() => waiter.settle(false, true), Math.max(0, request.timeoutMs));
      }
      if (ready()) waiter.settle(false, false);
    });
  }

  observe(event: AgentWorkerEvent | { type: 'worker-exited' }): void {
    if (event.type === 'worker-exited') {
      for (const agent of this.agents.values()) {
        const active = agent.activeRunId ? this.runs.get(agent.activeRunId) : undefined;
        if (active && !TERMINAL_RUN_STATUSES.has(active.status)) {
          this.finishRun(active, 'interrupted', 'Agent worker exited.');
        }
        agent.activeRunId = undefined;
        agent.status = agent.mode === 'coworker' ? 'parked' : 'closed';
      }
      return;
    }
    if (!('identity' in event) || !('parent' in event.identity)) return;
    let agent = [...this.agents.values()].find((candidate) =>
      isSameChildSessionIdentity(candidate.identity, event.identity)
    );
    if (!agent && event.type === 'child-ready') {
      agent = [...this.agents.values()].find(
        (candidate) =>
          candidate.mode === 'coworker' &&
          candidate.status !== 'closed' &&
          candidate.context.owner.kind === 'chatSession' &&
          candidate.context.owner.ownerId === event.identity.parent.sessionId &&
          candidate.identity.instanceId === event.identity.instanceId
      );
      if (agent) {
        agent.identity = event.identity;
        agent.status = agent.activeRunId ? 'active' : 'ready';
      }
    }
    if (!agent) return;
    const active = agent.activeRunId ? this.runs.get(agent.activeRunId) : undefined;
    if (event.type === 'message-upsert' && active) {
      const text = projectedText(event.message);
      if (text !== undefined) active.text = text;
      if (event.message.usage) {
        active.usageByMessage.set(event.index, {
          input: event.message.usage.input,
          output: event.message.usage.output,
        });
      }
      return;
    }
    if (
      (event.type === 'turn-completed' || event.type === 'turn-failed') &&
      active &&
      event.turnId === active.runId
    ) {
      if (event.type === 'turn-failed') {
        this.settleRun(agent, active, 'failed', event.error);
      } else if (active.schema !== undefined || active.gate !== undefined) {
        active.status = 'validating';
        void this.validateRun(agent, active);
      } else {
        this.settleRun(agent, active, 'succeeded');
      }
      return;
    }
    if (event.type === 'child-ended' || event.type === 'child-rejected') {
      const terminal = event.type === 'child-rejected' ? 'failed' : 'interrupted';
      if (active) {
        active.validationAbort?.abort();
        this.finishRun(active, terminal, event.reason);
      }
      for (const runId of agent.queuedRunIds) {
        const queued = this.runs.get(runId);
        if (queued) this.finishRun(queued, terminal, event.reason);
      }
      agent.queuedRunIds = [];
      agent.activeRunId = undefined;
      agent.status = 'closed';
    }
  }

  private allowedModes(context: AgentControlContext): ReadonlySet<AgentMode> {
    return this.options.allowedModes?.(context) ?? new Set<AgentMode>(['task', 'coworker']);
  }

  private validateContext<T>(context: AgentControlContext): AgentServiceResult<T> | undefined {
    const { actor, owner } = context;
    if (
      !owner.ownerId ||
      !owner.projectId ||
      actor.ownerId !== owner.ownerId ||
      actor.projectId !== owner.projectId ||
      !actor.actorId
    ) {
      return failure('invalid-context', 'Actor, owner and project identities do not match.');
    }
    if (actor.kind === 'agent' && owner.kind !== 'chatSession') {
      return failure('forbidden', 'Actor cannot control this owner.');
    }
    return undefined;
  }

  private ownedAgent(
    context: AgentControlContext,
    agentId: string
  ): AgentServiceResult<AgentRecord> {
    const invalid = this.validateContext<AgentRecord>(context);
    if (invalid) return invalid;
    const agent = this.agents.get(agentId);
    if (!agent || !this.sameOwner(agent.context, context)) {
      return failure('not-found', 'Agent was not found in this owner.');
    }
    return { ok: true, value: agent };
  }

  private ownedRun(context: AgentControlContext, runId: string): AgentServiceResult<RunRecord> {
    const invalid = this.validateContext<RunRecord>(context);
    if (invalid) return invalid;
    const run = this.runs.get(runId);
    if (!run || !this.sameOwner(run.context, context)) {
      return failure('not-found', 'Run was not found in this owner.');
    }
    return { ok: true, value: run };
  }

  private sameOwner(left: AgentControlContext, right: AgentControlContext): boolean {
    const sameOwner =
      left.owner.ownerId === right.owner.ownerId &&
      left.owner.projectId === right.owner.projectId &&
      left.owner.kind === right.owner.kind;
    if (!sameOwner) return false;
    if (right.actor.kind === 'user') return true;
    if (left.actor.kind !== 'agent' || right.actor.kind !== 'agent') return false;
    if (left.actor.actorId === right.actor.actorId) return true;
    const creator = left.actor.identity;
    return (
      'parent' in creator &&
      creator.parent.sessionId === right.actor.identity.sessionId &&
      creator.parent.generation === right.actor.identity.generation
    );
  }

  private createRun(
    agent: AgentRecord,
    runId: string,
    prompt: string,
    schema?: unknown,
    gate?: AgentRunGate
  ): RunRecord {
    return {
      context: agent.context,
      agentId: agent.agentId,
      runId,
      mode: agent.mode,
      status: 'queued',
      prompt,
      ...(schema !== undefined ? { schema } : {}),
      ...(gate !== undefined ? { gate } : {}),
      createdAt: this.now(),
      usageByMessage: new Map(),
    };
  }

  private async startRun(
    agent: AgentRecord,
    run: RunRecord
  ): Promise<AgentServiceResult<never> | { ok: true }> {
    agent.activeRunId = run.runId;
    agent.status = 'active';
    run.status = 'running';
    run.startedAt = this.now();
    const prompted = await this.options.runtime.prompt({
      context: agent.context,
      identity: agent.identity,
      agentId: agent.agentId,
      runId: run.runId,
      prompt: promptForRun(run),
      ...(run.schema !== undefined ? { schema: run.schema } : {}),
      ...(run.gate !== undefined ? { gate: run.gate } : {}),
    });
    if (prompted.ok) return { ok: true };
    agent.activeRunId = undefined;
    agent.status = 'ready';
    this.finishRun(run, 'failed', prompted.error ?? 'Prompt failed.');
    return failure('runtime-unavailable', prompted.error ?? 'Prompt failed.');
  }

  private async startNext(agent: AgentRecord): Promise<void> {
    if (agent.status === 'closed' || agent.activeRunId) return;
    const runId = agent.queuedRunIds.shift();
    if (!runId) return;
    const run = this.runs.get(runId);
    if (run?.status !== 'queued') {
      await this.startNext(agent);
      return;
    }
    await this.startRun(agent, run);
  }

  private async validateRun(agent: AgentRecord, run: RunRecord): Promise<void> {
    const validate = this.options.runtime.validate;
    if (!validate) {
      this.settleRun(agent, run, 'failed', 'Structured output or gate validation is unavailable.');
      return;
    }
    try {
      const validationAbort = new AbortController();
      run.validationAbort = validationAbort;
      const result = await validate({
        context: agent.context,
        identity: agent.identity,
        agentId: agent.agentId,
        runId: run.runId,
        prompt: run.prompt,
        ...(run.schema !== undefined ? { schema: run.schema } : {}),
        ...(run.gate !== undefined ? { gate: run.gate } : {}),
        ...(run.text !== undefined ? { text: run.text } : {}),
        signal: validationAbort.signal,
      });
      if (result.ok) {
        run.value = result.value;
        this.settleRun(agent, run, 'succeeded');
      } else {
        this.settleRun(agent, run, 'failed', result.error ?? 'Run validation failed.');
      }
    } catch (error) {
      this.settleRun(agent, run, 'failed', error instanceof Error ? error.message : String(error));
    } finally {
      run.validationAbort = undefined;
    }
  }

  private settleRun(
    agent: AgentRecord,
    run: RunRecord,
    status: Extract<AgentRunStatus, 'succeeded' | 'failed'>,
    error?: string
  ): void {
    if (TERMINAL_RUN_STATUSES.has(run.status)) return;
    this.finishRun(run, status, error);
    agent.activeRunId = undefined;
    agent.status = 'ready';
    if (agent.mode === 'task') {
      this.closeTask(agent);
    } else {
      void this.serial(agent.context.owner.ownerId, () => this.startNext(agent));
    }
  }

  /** task 只有一轮：完成、失败或被 stop 后都不能再用，关闭并回收子会话，否则留下孤儿 */
  private closeTask(agent: AgentRecord): void {
    if (agent.status === 'closed') return;
    agent.activeRunId = undefined;
    agent.status = 'closed';
    void this.options.runtime.dismiss({
      context: agent.context,
      identity: agent.identity,
      agentId: agent.agentId,
    });
  }

  private finishRun(run: RunRecord, status: AgentRunStatus, error?: string): void {
    if (TERMINAL_RUN_STATUSES.has(run.status)) return;
    run.status = status;
    run.finishedAt = this.now();
    if (error !== undefined) run.error = error;
    this.flushWaiters();
  }

  private snapshot(run: RunRecord): AgentRunSnapshot {
    return {
      owner: { ...run.context.owner },
      agentId: run.agentId,
      runId: run.runId,
      mode: run.mode,
      status: run.status,
      createdAt: run.createdAt,
      ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
      ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
    };
  }

  private runUsage(run: RunRecord): AgentRunReport['usage'] | undefined {
    if (run.usageByMessage.size === 0) return undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const usage of run.usageByMessage.values()) {
      inputTokens += usage.input;
      outputTokens += usage.output;
    }
    return { inputTokens, outputTokens };
  }

  private waitSatisfied(runIds: readonly string[], until: 'all' | 'any'): boolean {
    const terminal = runIds.map((runId) => {
      const run = this.runs.get(runId);
      return Boolean(run && TERMINAL_RUN_STATUSES.has(run.status));
    });
    return until === 'any' ? terminal.some(Boolean) : terminal.every(Boolean);
  }

  private waitReceipt(
    runIds: readonly string[],
    interrupted: boolean,
    timedOut: boolean
  ): AgentWaitReceipt {
    return {
      runs: runIds.map((runId) => this.snapshot(this.runs.get(runId)!)),
      timedOut,
      interrupted,
    };
  }

  private flushWaiters(): void {
    for (const waiter of [...this.waiters]) {
      if (this.waitSatisfied(waiter.runIds, waiter.until)) waiter.settle(false, false);
    }
  }

  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.queues.set(key, tail);
    void tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return result;
  }
}
