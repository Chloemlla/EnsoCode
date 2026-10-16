import type { AgentRunProgress } from '@shared/types/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubagentProgressPush } from './subagentProgressPush';

const run = (runId: string): AgentRunProgress => ({
  agentId: 'a',
  runId,
  status: 'running',
  elapsedMs: 0,
});

describe('SubagentProgressPush', () => {
  afterEach(() => vi.useRealTimers());

  it('首个更新立即发；窗口内后续更新合并为尾随一次且取最新', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const push = new SubagentProgressPush(send, 200);
    push.update('o1', [run('r1')]);
    expect(send).toHaveBeenCalledWith('o1', [run('r1')]);
    push.update('o1', [run('r2')]);
    push.update('o1', [run('r3')]);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('o1', [run('r3')]);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
    push.update('o1', []);
    expect(send).toHaveBeenLastCalledWith('o1', []);
  });

  it('不同 owner 各自分窗', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const push = new SubagentProgressPush(send, 200);
    push.update('o1', [run('r1')]);
    push.update('o2', [run('r2')]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('dispose 清掉未发的尾随更新', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const push = new SubagentProgressPush(send, 200);
    push.update('o1', [run('r1')]);
    push.update('o1', [run('r2')]);
    push.dispose();
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
