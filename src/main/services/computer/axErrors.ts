import { isAxStaleHandleError } from '@shared/computer/axRegistry';
import { ComputerError, StaleRefError } from '@shared/computer/errors';
import { AX_WORKER_EXITED } from './axWorkerClient';

/** macOS / Windows 后端共用：把 AX worker 的内部错误翻成模型能看懂的错误 */
export function translateAxError(error: unknown, ref?: string): unknown {
  if (ref && isAxStaleHandleError(error)) return new StaleRefError(ref);
  if (error instanceof Error && error.message === AX_WORKER_EXITED) {
    return new ComputerError(
      'ax-worker-exited',
      'AX worker exited unexpectedly; retry, or use screenshot coordinates'
    );
  }
  return error;
}

export async function withAxErrors<T>(run: () => Promise<T>, ref?: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateAxError(error, ref);
  }
}
