import { parentPort } from 'node:worker_threads';
import { performAxJob } from './axNative';
import type { AxWorkerJob } from './axWorkerClient';

const port =
  parentPort ?? (process as NodeJS.Process & { parentPort?: typeof parentPort }).parentPort;
if (!port) throw new Error('ax worker missing parentPort');

port.on('message', async (job: AxWorkerJob) => {
  try {
    const result = await performAxJob(job);
    port.postMessage({ id: job.id, ok: true, result });
  } catch (error) {
    port.postMessage({
      id: job.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
