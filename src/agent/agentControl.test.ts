import type { AgentControlToolRequest, AgentWorkerEvent } from '@shared/types/agent';
import { describe, expect, it, vi } from 'vitest';
import { AgentControlInvoker } from './agentControl';

const identity = {
  sessionId: 'parent',
  generation: '11111111-1111-4111-8111-111111111111',
};
const request: AgentControlToolRequest = { operation: 'report', runId: 'run-1' };

describe('AgentControlInvoker', () => {
  it('uses typed request ids and settles only the matching response', async () => {
    const emitted: AgentWorkerEvent[] = [];
    const invoker = new AgentControlInvoker(
      identity,
      (event) => emitted.push(event),
      () => 'r1'
    );
    const pending = invoker.invoke(request);
    expect(emitted).toEqual([
      {
        type: 'agent-control-invoke',
        identity,
        seq: 1,
        requestId: 'r1',
        request,
      },
    ]);
    expect(invoker.resolve('other', { ok: true, value: 'wrong' })).toBe(false);
    expect(invoker.resolve('r1', { ok: true, value: 'report' })).toBe(true);
    await expect(pending).resolves.toEqual({ ok: true, value: 'report' });
  });

  it('abort only cancels this observation request and ignores late result', async () => {
    const emitted: AgentWorkerEvent[] = [];
    const invoker = new AgentControlInvoker(
      identity,
      (event) => emitted.push(event),
      () => 'r2'
    );
    const controller = new AbortController();
    const pending = invoker.invoke(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/interrupted/i);
    expect(emitted.at(-1)).toMatchObject({
      type: 'agent-control-cancel',
      identity,
      requestId: 'r2',
    });
    expect(invoker.resolve('r2', { ok: true, value: 'late' })).toBe(false);
  });

  it('spawn/send 被 abort 时只通知 Main 打断附带的等待，仍等回执', async () => {
    const emitted: AgentWorkerEvent[] = [];
    const invoker = new AgentControlInvoker(
      identity,
      (event) => emitted.push(event),
      () => 'r3'
    );
    const controller = new AbortController();
    const pending = invoker.invoke(
      { operation: 'send', agentId: 'agent-1', message: 'more', delivery: 'auto', wait: true },
      controller.signal
    );
    controller.abort();
    expect(emitted.at(-1)).toMatchObject({ type: 'agent-control-cancel', requestId: 'r3' });
    const receipt = { ok: true as const, value: { agentId: 'agent-1', runId: 'run-1' } };
    expect(invoker.resolve('r3', receipt)).toBe(true);
    await expect(pending).resolves.toEqual(receipt);
  });

  it('close wakes all pending invocations', async () => {
    const invoker = new AgentControlInvoker(identity, vi.fn(), () => crypto.randomUUID());
    const one = invoker.invoke(request);
    const two = invoker.invoke(request);
    invoker.close('generation ended');
    await expect(one).rejects.toThrow('generation ended');
    await expect(two).rejects.toThrow('generation ended');
  });
});
