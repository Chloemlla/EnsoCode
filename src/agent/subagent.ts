import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type {
  AgentControlToolRequest,
  AgentControlToolResponse,
  AgentTypeSpawnConfig,
  SubagentModelOption,
} from '@shared/types/agent';
import { parseAgentControlToolRequest } from '@shared/types/agent';
import { CHILD_THINKING_LEVELS, resolveChildThinkingInput } from './childReasoning';

export interface UnifiedSubagentDeps {
  agentTypes: AgentTypeSpawnConfig[];
  models: SubagentModelOption[];
  invoke(request: AgentControlToolRequest, signal?: AbortSignal): Promise<AgentControlToolResponse>;
}

export function createUnifiedSubagentTool(deps: UnifiedSubagentDeps): ToolDefinition {
  const modelNames = deps.models.map((model) => model.name);
  const typeNames = deps.agentTypes.map((agentType) => agentType.name);
  const normalize = (params: Record<string, unknown>): AgentControlToolRequest | null => {
    const operation = params.operation;
    if (operation === 'spawn') {
      const agentTypeName = typeof params.agent_type === 'string' ? params.agent_type : undefined;
      const agentType = agentTypeName
        ? deps.agentTypes.find((candidate) => candidate.name === agentTypeName)
        : undefined;
      if (agentTypeName && !agentType) {
        throw new Error(
          `unknown agent_type "${agentTypeName}". Available: [${typeNames.join(', ')}]`
        );
      }
      const modelInput = typeof params.model === 'string' ? params.model : undefined;
      const { modelName, thinking } = resolveChildThinkingInput(
        modelInput,
        typeof params.thinking === 'string' ? params.thinking : undefined
      );
      if (modelName && !deps.models.some((model) => model.name === modelName)) {
        throw new Error(`unknown model "${modelName}". Available: [${modelNames.join(', ')}]`);
      }
      if (agentType && agentType.allowModelOverride === false && modelName) {
        throw new Error(`agent_type "${agentType.name}" does not allow custom model selection.`);
      }
      if (agentType?.allowModelOverride && !modelName) {
        throw new Error(
          `agent_type "${agentType.name}" requires a model. Available: [${modelNames.join(', ')}]`
        );
      }
      const description = typeof params.description === 'string' ? params.description.trim() : '';
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
      const name = typeof params.name === 'string' ? params.name.trim() : '';
      const label =
        description ||
        name ||
        prompt
          .split('\n')
          .map((line) => line.trim())
          .find(Boolean)
          ?.slice(0, 80) ||
        '';
      if (!label || !prompt) {
        const missing = [label ? '' : 'description', prompt ? '' : 'prompt'].filter(Boolean);
        throw new Error(`spawn requires non-empty ${missing.join(' and ')}`);
      }
      const candidate = {
        operation,
        mode: params.mode ?? 'task',
        ...(typeof params.name === 'string' ? { name: params.name } : {}),
        description: label,
        prompt,
        ...(agentTypeName ? { agentType: agentTypeName } : {}),
        ...(modelName ? { model: modelName } : {}),
        ...(thinking ? { thinking } : {}),
        wait: params.wait ?? false,
        ...(params.schema !== undefined ? { schema: params.schema } : {}),
        ...(params.gate !== undefined ? { gate: params.gate } : {}),
      };
      return parseAgentControlToolRequest(candidate);
    }
    if (operation === 'send') {
      return parseAgentControlToolRequest({
        operation,
        agentId: params.agentId,
        message: params.message,
        delivery: params.delivery ?? 'auto',
        ...(params.expectedRunId !== undefined ? { expectedRunId: params.expectedRunId } : {}),
        wait: params.wait ?? false,
        ...(params.schema !== undefined ? { schema: params.schema } : {}),
        ...(params.gate !== undefined ? { gate: params.gate } : {}),
      });
    }
    if (operation === 'wait') {
      const runIds = Array.isArray(params.runIds)
        ? params.runIds
        : params.runId !== undefined
          ? [params.runId]
          : [];
      return parseAgentControlToolRequest({
        operation,
        runIds,
        until: params.until ?? 'all',
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      });
    }
    if (operation === 'report' || operation === 'stop') {
      return parseAgentControlToolRequest({ operation, runId: params.runId });
    }
    if (operation === 'dismiss') {
      return parseAgentControlToolRequest({ operation, agentId: params.agentId });
    }
    if (operation === 'list') {
      return parseAgentControlToolRequest({
        operation,
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
        limit: params.limit ?? 20,
      });
    }
    if (operation === 'message') {
      return parseAgentControlToolRequest({ operation, to: params.to, text: params.text });
    }
    return null;
  };
  return {
    name: 'subagent',
    label: 'Subagent',
    description:
      'Spawn requires non-empty description and prompt parameters; omit both for every other operation. ' +
      'Create and control delegated agents. mode=task is one-shot; mode=coworker preserves context for multiple Runs. ' +
      'All operations are Main-authorized. Spawning and sending are asynchronous unless wait:true.',
    promptSnippet:
      'subagent: spawn requires non-empty description and prompt. Other operations omit both. ' +
      'Spawn task/coworker agents, list owned agents, send Runs or bound messages, wait/report/stop a Run, or dismiss an Agent. Default spawn mode=task and wait=false.',
    promptGuidelines: [
      'spawn requires non-empty description and prompt. Omit both for every other operation.',
      'Agent and Run are different identities: use runId for wait/report/stop and agentId for send/dismiss.',
      'wait timeout or interruption never stops execution; use stop or dismiss explicitly.',
      'Use send delivery=auto to steer a running Run or start an idle coworker Run; delivery=next queues a new coworker Run.',
      'Dismiss a coworker as soon as you no longer need it; an idle coworker keeps its session open until dismissed.',
      'gate.commandRef is a Main-authorized command id, not shell text or argv.',
      'Unknown gate ids fail the run and nothing is executed.',
      ...(modelNames.length > 0
        ? [
            `model must be copied exactly from the model enum: ${modelNames.join(', ')}. Short names are rejected.`,
          ]
        : []),
    ],
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['spawn', 'send', 'wait', 'report', 'list', 'message', 'stop', 'dismiss'],
        },
        mode: { type: 'string', enum: ['task', 'coworker'] },
        name: { type: 'string' },
        description: {
          type: 'string',
          description: 'Required for spawn: non-empty short label of the delegated work.',
        },
        prompt: {
          type: 'string',
          description: 'Required for spawn: non-empty task instructions.',
        },
        ...(deps.agentTypes.length > 0
          ? {
              agent_type: {
                type: 'string',
                description: `Agent type: ${deps.agentTypes
                  .map((type) => `${type.name} (${type.description || 'custom'})`)
                  .join('; ')}`,
              },
            }
          : {}),
        ...(deps.models.length > 0
          ? {
              model: {
                type: 'string',
                enum: modelNames,
                description:
                  'Exact model id from the model enum. Short names and guessed ids are rejected.',
              },
            }
          : {}),
        thinking: { type: 'string', enum: [...CHILD_THINKING_LEVELS] },
        wait: { type: 'boolean', description: 'Default false. Only wait for this tool call.' },
        schema: { type: 'object' },
        gate: {
          type: 'object',
          description: 'Main command id, not a shell command. Unknown ids are rejected.',
          properties: { commandRef: { type: 'string' } },
          required: ['commandRef'],
          additionalProperties: false,
        },
        agentId: { type: 'string' },
        runId: { type: 'string' },
        runIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true },
        message: { type: 'string' },
        delivery: { type: 'string', enum: ['auto', 'steer', 'next'] },
        expectedRunId: { type: 'string' },
        until: { type: 'string', enum: ['all', 'any'] },
        timeoutMs: { type: 'integer', minimum: 0, maximum: 86_400_000 },
        status: { type: 'string', enum: ['creating', 'ready', 'active', 'parked', 'closed'] },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        to: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['operation'],
      allOf: [
        {
          if: {
            properties: { operation: { const: 'spawn' } },
            required: ['operation'],
          },
          // biome-ignore lint/suspicious/noThenProperty: JSON Schema 的 if/then 关键字
          then: { required: ['description', 'prompt'] },
        },
      ],
      additionalProperties: false,
    } as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params, signal) {
      const request = normalize(params as Record<string, unknown>);
      if (!request) throw new Error('invalid subagent operation parameters');
      // spawn/send 被 abort 时 invoker 只让 Main 打断附带的等待，仍等权威 receipt，不丢 agentId/runId
      const response = await deps.invoke(request, signal);
      if (!response.ok) throw new Error(`${response.code}: ${response.error}`);
      const serialized = JSON.stringify(response.value, null, 2);
      return {
        content: [{ type: 'text', text: serialized ?? 'null' }],
        details: response.value,
      };
    },
  };
}

export const COWORKER_IDLE_TOOL_CALLS = 20;

type IdleCoworker = { runIds: Set<string>; idle: number; nextAt: number; seen: boolean };

/**
 * 主 agent 自己用 subagent 雇的 coworker 闲置超过 threshold 次工具调用时提醒解雇。
 * worker 不知道 agentId：登记 spawn 回执，再按 Main 下发给子会话的 runId 找到它、看是否在跑。
 * 提醒后又被使用说明仍要留着，下次间隔翻倍，不再按初始阈值反复打扰。
 */
export class CoworkerIdleReminder {
  private readonly coworkers = new Map<string, IdleCoworker>();

  constructor(private readonly threshold = COWORKER_IDLE_TOOL_CALLS) {}

  /** 每次 subagent 调用返回后调用：spawn 登记、dismiss 注销，其余指向它的操作算使用 */
  observe(request: AgentControlToolRequest, response: AgentControlToolResponse): void {
    if (!response.ok) return;
    const { agentId, runId } = (response.value ?? {}) as { agentId?: unknown; runId?: unknown };
    if (request.operation === 'spawn') {
      if (request.mode === 'coworker' && typeof agentId === 'string' && typeof runId === 'string') {
        this.coworkers.set(agentId, {
          runIds: new Set([runId]),
          idle: 0,
          nextAt: this.threshold,
          seen: false,
        });
      }
      return;
    }
    if (request.operation === 'dismiss') {
      this.coworkers.delete(request.agentId);
      return;
    }
    const target =
      request.operation === 'send'
        ? request.agentId
        : request.operation === 'message'
          ? request.to
          : undefined;
    const runIds =
      request.operation === 'wait'
        ? request.runIds
        : request.operation === 'report' || request.operation === 'stop'
          ? [request.runId]
          : [];
    for (const [id, coworker] of this.coworkers) {
      if (id !== target && !runIds.some((run) => coworker.runIds.has(run))) continue;
      coworker.idle = 0;
      if (id === target && typeof runId === 'string') coworker.runIds.add(runId);
    }
  }

  /** SystemReminderRegistry 在主 agent 每次工具调用后调用；lookup 按 runId 找子会话 */
  take(
    lookup: (runIds: ReadonlySet<string>) => { name: string; running: boolean } | null
  ): string[] {
    const due: string[] = [];
    for (const [agentId, coworker] of this.coworkers) {
      const child = lookup(coworker.runIds);
      if (!child) {
        // 已解雇或会话已结束；子会话还没收到 Run 时先留着
        if (coworker.seen) this.coworkers.delete(agentId);
        continue;
      }
      coworker.seen = true;
      if (child.running) {
        coworker.idle = 0;
        continue;
      }
      coworker.idle += 1;
      if (coworker.idle <= coworker.nextAt) continue;
      coworker.nextAt = coworker.idle * 2;
      due.push(
        `- ${child.name} (agentId ${agentId}): idle for the last ${coworker.idle} tool calls`
      );
    }
    if (due.length === 0) return [];
    return [
      `These coworkers you spawned have not been used for a while:\n${due.join('\n')}\n\n` +
        'An idle coworker keeps its session open until dismissed. ' +
        'If you no longer need one, call subagent with operation=dismiss and its agentId now; ' +
        'if you still plan to use it, ignore this. Do not mention this reminder to the user.',
    ];
  }
}

/** 从 pi 会话消息取最后一条 assistant 文本 */
export function lastAssistantText(session: AgentSession): string {
  const messages = session.messages as { role?: string; content?: unknown }[];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .join('');
      if (text.trim()) return text;
    }
  }
  return '';
}
