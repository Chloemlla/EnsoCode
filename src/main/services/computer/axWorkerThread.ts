import { parentPort } from 'node:worker_threads';
import { unwrapAxWorkerMessage } from './axWorkerClient';

interface Port {
  on(event: 'message', handler: (message: unknown) => void): void;
  postMessage(message: unknown): void;
}

// utilityProcess 的 parentPort 投递 MessageEvent（job 在 .data），worker_threads 直接投递 job
const utilityPort = (process as unknown as { parentPort?: Port }).parentPort;
const port: Port | null | undefined = parentPort ?? utilityPort;
if (!port) throw new Error('ax worker missing parentPort');

port.on('message', async (message) => {
  const job = unwrapAxWorkerMessage(message, !parentPort);
  if (!job) return;
  try {
    const result =
      process.platform === 'win32'
        ? await (await import('./winUia')).performWinUiaJob(job)
        : await (await import('./axNative')).performAxJob(job);
    port.postMessage({ id: job.id, ok: true, result });
  } catch (error) {
    port.postMessage({
      id: job.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
