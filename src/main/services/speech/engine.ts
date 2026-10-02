import type { Worker } from 'node:worker_threads';

export interface SpeechEngineStream {
  /** 返回截至目前的全文 */
  accept(samples: Float32Array): Promise<string>;
  finish(): Promise<string>;
  cancel(): void;
}

export interface SpeechEngine {
  /** 整段识别（仅非流式模型） */
  transcribe(samples: Float32Array): Promise<string>;
  /** 流式识别（仅流式模型） */
  openStream(): SpeechEngineStream;
  /** 云端引擎：开录前预先建连 */
  prewarm?(): void;
  dispose(): void;
}

export interface EngineWorkerData {
  wrapperDir: string;
  kind: 'offline' | 'online';
  config: Record<string, unknown>;
}

export type EngineRequest =
  | { id: number; op: 'transcribe'; samples: Float32Array }
  | { id: number; op: 'open' | 'finish' | 'cancel'; sid: number }
  | { id: number; op: 'accept'; sid: number; samples: Float32Array };

type EngineCall = EngineRequest extends infer R
  ? R extends unknown
    ? Omit<R, 'id'>
    : never
  : never;

type EngineReply =
  | { id: number; ok: true; text: string }
  | { id: number; ok: false; error: string };

/** 一个 worker 只装一个模型；卸载即 terminate，原生内存随线程回收 */
export async function createWorkerEngine(data: EngineWorkerData): Promise<SpeechEngine> {
  const { default: spawn } = await import('./engineWorker?nodeWorker');
  const worker: Worker = spawn({ workerData: data });
  const pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (e: Error) => void }
  >();
  let dead: Error | null = null;
  let nextId = 1;
  let nextSid = 1;

  const failAll = (error: Error) => {
    dead ??= error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  await new Promise<void>((resolve, reject) => {
    const onReady = (message: { ready?: boolean; error?: string }) => {
      if (message.ready === undefined) return;
      worker.off('message', onReady);
      if (message.ready) resolve();
      else {
        void worker.terminate();
        reject(new Error(message.error ?? 'speech engine failed to load'));
      }
    };
    worker.on('message', onReady);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`speech engine exited (${code})`)));
  });

  worker.on('message', (reply: EngineReply) => {
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.text);
    else waiter.reject(new Error(reply.error));
  });
  worker.on('error', (error: unknown) =>
    failAll(error instanceof Error ? error : new Error(String(error)))
  );
  worker.on('exit', (code) => failAll(new Error(`speech engine exited (${code})`)));

  const call = (req: EngineCall): Promise<string> => {
    if (dead) return Promise.reject(dead);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id });
    });
  };

  return {
    transcribe: (samples) => call({ op: 'transcribe', samples }),
    openStream: () => {
      const sid = nextSid++;
      const opened = call({ op: 'open', sid });
      return {
        accept: (samples) => opened.then(() => call({ op: 'accept', sid, samples })),
        finish: () => opened.then(() => call({ op: 'finish', sid })),
        cancel: () => {
          void opened.then(() => call({ op: 'cancel', sid })).catch(() => {});
        },
      };
    },
    dispose: () => {
      failAll(new Error('speech engine disposed'));
      void worker.terminate();
    },
  };
}
