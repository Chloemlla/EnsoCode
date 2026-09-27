import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { killAndWaitExit } from './processExit';

function child() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { kill: vi.fn(() => true) });
}

describe('killAndWaitExit', () => {
  it('发出终止信号并等到进程退出', async () => {
    const proc = child();
    let done = false;
    const pending = killAndWaitExit(proc, 5_000).then(() => {
      done = true;
    });
    expect(proc.kill).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(done).toBe(false);
    proc.emit('exit', 0);
    await pending;
    expect(done).toBe(true);
  });

  it('进程迟迟不退出时到时限放行，不卡住应用退出', async () => {
    vi.useFakeTimers();
    const proc = child();
    const pending = killAndWaitExit(proc, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
