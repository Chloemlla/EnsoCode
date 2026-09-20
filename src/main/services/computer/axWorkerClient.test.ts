import { describe, expect, it, vi } from 'vitest';
import { createAxWorkerClient, spawnAxWorkerThread, wrapUtilityProcess } from './axWorkerClient';

const { FakeWorker, workers } = vi.hoisted(() => {
  const workers: Array<{ filename: string }> = [];
  class FakeWorker {
    filename: string;
    constructor(filename: string) {
      this.filename = filename;
      workers.push(this);
    }
    postMessage() {}
    terminate() {}
    on() {}
  }
  return { FakeWorker, workers };
});

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

describe('createAxWorkerClient', () => {
  it('超时会 terminate worker，并抛 AX_TIMEOUT', async () => {
    const terminate = vi.fn(async () => {});
    const handlers = new Map<string, (value: unknown) => void>();
    const client = createAxWorkerClient({
      timeoutMs: 20,
      spawn: () => ({
        postMessage: () => {},
        terminate,
        on: (event: string, handler: (value: unknown) => void) => {
          handlers.set(event, handler);
        },
      }),
    });
    await expect(client.call({ op: 'snapshot', pid: 1, maxDepth: 1 })).rejects.toThrow(
      'AX_TIMEOUT'
    );
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('worker 正常返回时不 terminate', async () => {
    const terminate = vi.fn(async () => {});
    const handlers = new Map<string, (value: unknown) => void>();
    const client = createAxWorkerClient({
      timeoutMs: 1000,
      spawn: () => ({
        postMessage: (job: { id: string }) => {
          queueMicrotask(() => handlers.get('message')?.({ id: job.id, ok: true, result: [] }));
        },
        terminate,
        on: (event: string, handler: (value: unknown) => void) => {
          handlers.set(event, handler);
        },
      }),
    });
    await expect(client.call({ op: 'snapshot', pid: 1, maxDepth: 1 })).resolves.toEqual([]);
    expect(terminate).not.toHaveBeenCalled();
  });
});

describe('createAxWorkerClient crash isolation', () => {
  it('worker 异常退出时把挂起的调用变成 AX_TIMEOUT', async () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const client = createAxWorkerClient({
      timeoutMs: 1000,
      spawn: () => ({
        postMessage: () => {
          queueMicrotask(() => handlers.get('exit')?.(undefined));
        },
        terminate: vi.fn(),
        on: (event: string, handler: (value: unknown) => void) => {
          handlers.set(event, handler);
        },
      }),
    });
    await expect(client.call({ op: 'snapshot', pid: 1, maxDepth: 1 })).rejects.toThrow(
      'AX_TIMEOUT'
    );
  });
});

describe('wrapUtilityProcess', () => {
  it('spawn 完成前的消息会排队', () => {
    const posted: unknown[] = [];
    const handlers = new Map<string, () => void>();
    const handle = wrapUtilityProcess({
      postMessage: (job) => posted.push(job),
      kill: () => true,
      on: () => {},
      once: (event, handler) => {
        handlers.set(event, handler);
      },
    });
    handle.postMessage({ id: '1', op: 'focused' });
    expect(posted).toEqual([]);
    handlers.get('spawn')?.();
    expect(posted).toEqual([{ id: '1', op: 'focused' }]);
  });
});

describe('spawnAxWorkerThread', () => {
  it('在同进程 Worker 里跑 AX，不 fork Electron Helper', () => {
    workers.length = 0;
    const handle = spawnAxWorkerThread('/tmp/ax-worker.js');
    expect(workers).toEqual([{ filename: '/tmp/ax-worker.js' }]);
    handle.postMessage({ id: '1', op: 'focused' });
  });
});
