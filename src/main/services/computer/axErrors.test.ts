import { AX_STALE_HANDLE } from '@shared/computer/axRegistry';
import { ComputerError, StaleRefError } from '@shared/computer/errors';
import { describe, expect, it } from 'vitest';
import { withAxErrors } from './axErrors';
import { AX_WORKER_EXITED } from './axWorkerClient';

const fail = (message: string) => () => Promise.reject(new Error(message));

describe('withAxErrors', () => {
  it('worker 退出变成可读的 ax-worker-exited，而不是裸常量', async () => {
    const error = await withAxErrors(fail(AX_WORKER_EXITED)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ComputerError);
    expect((error as ComputerError).code).toBe('ax-worker-exited');
    expect((error as Error).message).toMatch(/AX worker exited/);
  });

  it('带 ref 的过期句柄变成 StaleRef', async () => {
    const error = await withAxErrors(fail(`${AX_STALE_HANDLE}: ax-1-2`), 'e5').catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(StaleRefError);
    expect((error as Error).message).toMatch(/e5/);
  });

  it('其他错误原样抛出，成功值原样返回', async () => {
    await expect(withAxErrors(fail('AX_TIMEOUT'))).rejects.toThrow('AX_TIMEOUT');
    await expect(withAxErrors(async () => 3)).resolves.toBe(3);
  });
});
