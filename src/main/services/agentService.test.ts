import type { ChildSessionIdentity } from '@shared/builtinAgents';
import type {
  AgentControlContext,
  AgentControlSpawnRequest,
  AgentOwnerIdentity,
} from '@shared/types/agent';
import { describe, expect, it, vi } from 'vitest';
import { AgentService, type AgentServiceRuntime } from './agentService';

const owner: AgentOwnerIdentity = {
  ownerId: 'chat-1',
  projectId: 'project-1',
  kind: 'chatSession',
};
const context: AgentControlContext = {
  owner,
  actor: {
    kind: 'agent',
    actorId: 'chat-1',
    ownerId: owner.ownerId,
    projectId: owner.projectId,
    identity: {
      sessionId: 'chat-1',
      generation: '11111111-1111-4111-8111-111111111111',
    },
  },
};

function child(agentId: string, generation: string): ChildSessionIdentity {
  return {
    sessionId: `chat-1::agent-${agentId}`,
    generation,
    parent: context.actor.kind === 'agent' ? context.actor.identity : ({} as never),
    instanceId: agentId,
    instanceName: `agent-${agentId}`,
    typeKey: 'builtin:worker',
  };
}

function setup() {
  let generation = 0;
  const children: ChildSessionIdentity[] = [];
  const runtime: AgentServiceRuntime = {
    spawn: vi.fn(async ({ agentId }) => {
      const identity = child(
        agentId,
        `22222222-2222-4222-8222-${String(++generation).padStart(12, '0')}`
      );
      children.push(identity);
      return identity;
    }),
    prompt: vi.fn(async () => ({ ok: true })),
    steer: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    dismiss: vi.fn(async () => ({ ok: true })),
    validate: vi.fn(async () => ({ ok: true, value: { accepted: true } })),
  };
  let id = 0;
  return {
    children,
    runtime,
    service: new AgentService({
      runtime,
      randomUuid: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++id).padStart(12, '0')}`,
      now: () => id,
    }),
  };
}

function spawnRequest(overrides: Partial<AgentControlSpawnRequest> = {}): AgentControlSpawnRequest {
  return {
    context,
    requestId: 'request-1',
    description: 'implement change',
    prompt: 'do the work',
    ...overrides,
  };
}

describe('AgentService lifecycle', () => {
  it('不注入 randomUuid 时默认 id 生成器可直接调用', async () => {
    // crypto.randomUUID 解绑后调用会抛 "Value of \"this\" must be of type Crypto"。
    const { runtime } = setup();
    const service = new AgentService({ runtime });
    const result = await service.spawn(spawnRequest());
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.agentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('spawn 默认 task + 异步，Agent 与 Run 使用独立稳定身份', async () => {
    const { service, runtime } = setup();
    const result = await service.spawn(spawnRequest());
    expect(result).toEqual({
      ok: true,
      value: {
        agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
        mode: 'task',
        status: 'running',
      },
    });
    expect(runtime.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
        prompt: 'do the work',
      })
    );
  });

  it('adopts a persisted agent-tool coworker by stable instanceId after Main restart', async () => {
    const { service, runtime } = setup();
    const restored = {
      sessionId: 'parent::cw-persisted-agent',
      generation: '99999999-9999-4999-8999-999999999999',
      parent: context.actor.kind === 'agent' ? context.actor.identity : ({} as never),
      instanceId: 'persisted-agent',
      instanceName: 'reviewer',
      typeKey: 'builtin:worker' as const,
    };
    expect(service.adoptCoworker(context, restored)).toBe(true);
    await expect(
      service.list({ context, requestId: 'list-restored', limit: 20 })
    ).resolves.toMatchObject({
      ok: true,
      value: { agents: [{ agentId: 'persisted-agent', status: 'ready' }] },
    });
    const sent = await service.message({
      context,
      requestId: 'after-restart',
      to: 'persisted-agent',
      text: 'continue',
    });
    expect(sent).toMatchObject({ ok: true, value: { agentId: 'persisted-agent' } });
    expect(runtime.prompt).toHaveBeenCalledWith(expect.objectContaining({ identity: restored }));
  });

  it('child-ended closes an adopted coworker that never started a run', async () => {
    const { service } = setup();
    const restored = {
      sessionId: 'parent::cw-persisted-agent',
      generation: '99999999-9999-4999-8999-999999999999',
      parent: context.actor.kind === 'agent' ? context.actor.identity : ({} as never),
      instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',
      instanceName: 'reviewer',
      typeKey: 'builtin:worker' as const,
    };
    expect(service.adoptCoworker(context, restored)).toBe(true);
    service.observe({
      type: 'child-ended',
      identity: restored,
      seq: 1,
      reason: 'dismissed',
    });
    await expect(
      service.list({ context, requestId: 'list-ended', limit: 20 })
    ).resolves.toMatchObject({
      ok: true,
      value: { agents: [{ agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099', status: 'closed' }] },
    });
  });

  it('schema is included in the child prompt', async () => {
    const { service, runtime } = setup();
    const schema = { type: 'object', required: ['ok'] };
    await service.spawn(spawnRequest({ schema }));
    expect(runtime.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          'do the work',
          '',
          'Return exactly one JSON value matching this schema:',
          JSON.stringify(schema),
        ].join('\n'),
      })
    );
  });

  it('rechecks terminal state after awaited steer delivery', async () => {
    const { service, runtime, children } = setup();
    const spawned = await service.spawn(spawnRequest({ mode: 'coworker' }));
    if (!spawned.ok) throw new Error(spawned.error);
    vi.mocked(runtime.steer).mockImplementationOnce(async () => {
      service.observe({
        type: 'turn-completed',
        identity: children[0],
        seq: 1,
        turnId: spawned.value.runId,
      });
      return { ok: true };
    });
    await expect(
      service.send({
        context,
        requestId: 'late-steer',
        agentId: spawned.value.agentId,
        message: 'more',
        delivery: 'steer',
      })
    ).resolves.toMatchObject({ ok: false, code: 'invalid-state' });
  });

  it('does not authorize sibling actors merely because they share an owner', async () => {
    const { service } = setup();
    const spawned = await service.spawn(spawnRequest({ mode: 'coworker' }));
    if (!spawned.ok) throw new Error(spawned.error);
    const siblingContext: AgentControlContext = {
      ...context,
      actor: {
        kind: 'agent',
        actorId: 'sibling',
        ownerId: owner.ownerId,
        projectId: owner.projectId,
        identity: child('sibling', '88888888-8888-4888-8888-888888888888'),
      },
    };
    await expect(
      service.report({
        context: siblingContext,
        requestId: 'sibling-read',
        runId: spawned.value.runId,
      })
    ).resolves.toMatchObject({ ok: false, code: 'not-found' });
  });

  it('schema/gate 在完成后进入 validating，并以 Main runtime 结果结算报告', async () => {
    const { service, runtime, children } = setup();
    const spawned = await service.spawn(
      spawnRequest({ mode: 'coworker', schema: { type: 'object' }, gate: { commandRef: 'tests' } })
    );
    if (!spawned.ok) throw new Error(spawned.error);
    service.observe({
      type: 'message-upsert',
      identity: children[0],
      seq: 1,
      index: 0,
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: '{"accepted":true}' }],
        usage: { input: 12, output: 5, cacheRead: 0, cacheWrite: 0 },
      },
    });
    service.observe({
      type: 'turn-completed',
      identity: children[0],
      seq: 2,
      turnId: spawned.value.runId,
    });
    await vi.waitFor(() => expect(runtime.validate).toHaveBeenCalled());
    const report = await service.report({
      context,
      requestId: 'report-validation',
      runId: spawned.value.runId,
    });
    expect(report).toMatchObject({
      ok: true,
      value: {
        run: { status: 'succeeded' },
        value: { accepted: true },
        usage: { inputTokens: 12, outputTokens: 5 },
      },
    });
  });

  it('stop 可取消 validating，迟到的 gate 结果不能把 Run 改回成功', async () => {
    const { service, runtime, children } = setup();
    const deferred = Promise.withResolvers<{ ok: true; value: unknown }>();
    vi.mocked(runtime.validate!).mockReturnValueOnce(deferred.promise);
    const spawned = await service.spawn(
      spawnRequest({ mode: 'coworker', gate: { commandRef: 'tests' } })
    );
    if (!spawned.ok) throw new Error(spawned.error);
    service.observe({
      type: 'turn-completed',
      identity: children[0],
      seq: 1,
      turnId: spawned.value.runId,
    });
    await vi.waitFor(() => expect(runtime.validate).toHaveBeenCalled());
    expect(
      await service.stop({ context, requestId: 'stop-validating', runId: spawned.value.runId })
    ).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    expect(vi.mocked(runtime.validate!).mock.calls[0]?.[0].signal?.aborted).toBe(true);
    expect(runtime.stop).not.toHaveBeenCalled();
    deferred.resolve({ ok: true, value: { late: true } });
    await Promise.resolve();
    expect(
      await service.report({ context, requestId: 'late-report', runId: spawned.value.runId })
    ).toMatchObject({ ok: true, value: { run: { status: 'cancelled' } } });
  });

  it('running auto/steer 返回原 run；expectedRunId 不匹配时不投递', async () => {
    const { service, runtime } = setup();
    const spawned = await service.spawn(spawnRequest({ mode: 'coworker' }));
    if (!spawned.ok) throw new Error(spawned.error);
    const steered = await service.send({
      context,
      requestId: 'send-1',
      agentId: spawned.value.agentId,
      message: 'adjust it',
      delivery: 'auto',
      expectedRunId: spawned.value.runId,
    });
    expect(steered).toEqual({
      ok: true,
      value: {
        agentId: spawned.value.agentId,
        runId: spawned.value.runId,
        delivery: 'steer',
        status: 'running',
      },
    });
    expect(runtime.steer).toHaveBeenCalledTimes(1);
    const stale = await service.send({
      context,
      requestId: 'send-2',
      agentId: spawned.value.agentId,
      message: 'wrong run',
      expectedRunId: 'stale-run',
    });
    expect(stale).toMatchObject({ ok: false, code: 'run-mismatch' });
    expect(runtime.steer).toHaveBeenCalledTimes(1);
  });

  it('next 只给 coworker 排新 Run，当前 Run 完成后按序启动', async () => {
    const { children, service, runtime } = setup();
    const spawned = await service.spawn(spawnRequest({ mode: 'coworker' }));
    if (!spawned.ok) throw new Error(spawned.error);
    const queued = await service.send({
      context,
      requestId: 'send-next',
      agentId: spawned.value.agentId,
      message: 'second round',
      delivery: 'next',
    });
    expect(queued).toMatchObject({ ok: true, value: { delivery: 'next', status: 'queued' } });
    expect(runtime.prompt).toHaveBeenCalledTimes(1);
    service.observe({
      type: 'turn-completed',
      identity: children[0],
      seq: 2,
      turnId: spawned.value.runId,
    });
    await vi.waitFor(() => expect(runtime.prompt).toHaveBeenCalledTimes(2));
  });

  it('wait 的 AbortSignal 只中断等待，不停止正在执行的 Run', async () => {
    const { service, runtime } = setup();
    const spawned = await service.spawn(spawnRequest({ mode: 'coworker' }));
    if (!spawned.ok) throw new Error(spawned.error);
    const abort = new AbortController();
    const waiting = service.wait(
      { context, requestId: 'wait-1', runIds: [spawned.value.runId] },
      abort.signal
    );
    abort.abort();
    expect(await waiting).toMatchObject({
      ok: true,
      value: { timedOut: false, interrupted: true },
    });
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(runtime.dismiss).not.toHaveBeenCalled();
  });

  it('worker 重建后 coworker 仅按同 owner+instanceId 绑定新 generation', async () => {
    const { service, runtime, children } = setup();
    const spawned = await service.spawn(spawnRequest({ mode: 'coworker' }));
    if (!spawned.ok) throw new Error(spawned.error);
    service.observe({ type: 'worker-exited' });
    const replacement: ChildSessionIdentity = {
      ...children[0],
      generation: '99999999-9999-4999-8999-999999999999',
      parent: {
        ...children[0].parent,
        generation: '88888888-8888-4888-8888-888888888888',
      },
    };
    service.observe({ type: 'child-ready', identity: replacement } as never);
    await service.send({
      context,
      requestId: 'after-worker-restart',
      agentId: spawned.value.agentId,
      message: 'continue',
      delivery: 'next',
    });
    expect(runtime.prompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ identity: replacement })
    );
  });

  it('stop 只终止 Run 并保留 coworker；dismiss 关闭实例且幂等', async () => {
    const { service, runtime } = setup();
    const spawned = await service.spawn(spawnRequest({ mode: 'coworker' }));
    if (!spawned.ok) throw new Error(spawned.error);
    expect(
      await service.stop({ context, requestId: 'stop-1', runId: spawned.value.runId })
    ).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(runtime.dismiss).not.toHaveBeenCalled();
    const dismissed = {
      context,
      requestId: 'dismiss-1',
      agentId: spawned.value.agentId,
    };
    expect(await service.dismiss(dismissed)).toMatchObject({ ok: true });
    expect(await service.dismiss({ ...dismissed, requestId: 'dismiss-2' })).toMatchObject({
      ok: true,
    });
    expect(runtime.dismiss).toHaveBeenCalledTimes(1);
  });

  it('stop 掉 task 唯一的 Run 后关闭实例并回收子会话，不留孤儿', async () => {
    const { service, runtime } = setup();
    const spawned = await service.spawn(spawnRequest());
    if (!spawned.ok) throw new Error(spawned.error);
    expect(
      await service.stop({ context, requestId: 'stop-task', runId: spawned.value.runId })
    ).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(runtime.dismiss).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: spawned.value.agentId })
    );
    expect(
      await service.send({
        context,
        requestId: 'send-after-stop',
        agentId: spawned.value.agentId,
        message: 'again',
      })
    ).toMatchObject({ ok: false, code: 'invalid-state' });
    await service.dismiss({
      context,
      requestId: 'dismiss-after-stop',
      agentId: spawned.value.agentId,
    });
    expect(runtime.dismiss).toHaveBeenCalledTimes(1);
  });

  it('task stop 途中子会话先收尾时只回收一次', async () => {
    const { service, runtime, children } = setup();
    const spawned = await service.spawn(spawnRequest());
    if (!spawned.ok) throw new Error(spawned.error);
    vi.mocked(runtime.stop).mockImplementationOnce(async () => {
      service.observe({
        type: 'turn-completed',
        identity: children[0],
        seq: 1,
        turnId: spawned.value.runId,
      });
      return { ok: true };
    });
    await service.stop({ context, requestId: 'stop-race', runId: spawned.value.runId });
    expect(runtime.dismiss).toHaveBeenCalledTimes(1);
  });

  it('owner/project/actor 不一致时在 runtime 前拒绝', async () => {
    const { service, runtime } = setup();
    const result = await service.spawn(
      spawnRequest({
        context: {
          ...context,
          owner: { ...owner, projectId: 'other-project' },
        },
      })
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid-context' });
    expect(runtime.spawn).not.toHaveBeenCalled();
  });
});
