import { type BashOperations, createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  bindForegroundCommand,
  type DetachableProcess,
  ForegroundCommand,
  ForegroundDetachedError,
  withDetachableExec,
} from './foregroundCommand';

const until = (pred: () => boolean, ms = 5000) =>
  new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (pred()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(timer);
        reject(new Error('timeout'));
      }
    }, 20);
  });

function setup(timeoutAction: 'background' | 'kill' = 'background', adoptError?: Error) {
  const adopted: DetachableProcess[] = [];
  const command = new ForegroundCommand(timeoutAction, {
    adopt: (proc) => {
      if (adoptError) throw adoptError;
      adopted.push(proc);
      return `task-${adopted.length}`;
    },
    attachFinalize: () => {},
  });
  const controller = new AbortController();
  bindForegroundCommand(controller.signal, command);
  const ops = withDetachableExec(createLocalBashOperations());
  const seen: string[] = [];
  const run = (script: string, timeout?: number) =>
    ops.exec(script, process.cwd(), {
      onData: (chunk) => seen.push(chunk.toString()),
      signal: controller.signal,
      timeout,
    });
  return { command, controller, adopted, seen, run };
}

describe('withDetachableExec', () => {
  it('未登记前台命令的 signal 原样透传给底层 exec', async () => {
    const calls: unknown[] = [];
    const inner: BashOperations = {
      exec: async (_command, _cwd, options) => {
        calls.push(options.timeout);
        return { exitCode: 0 };
      },
    };
    const result = await withDetachableExec(inner).exec('true', '/', {
      onData: () => {},
      signal: new AbortController().signal,
      timeout: 7,
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(calls).toEqual([7]);
  });

  it('转后台：前台立即以带已有输出的 ForegroundDetachedError 结束，进程继续运行并移交输出', async () => {
    const { command, adopted, seen, run } = setup();
    const pending = run('echo before; sleep 0.4; echo after');
    await until(() => seen.join('').includes('before'));

    expect(command.detach('user')).toBe('task-1');
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForegroundDetachedError);
    expect(error).toMatchObject({ taskId: 'task-1', reason: 'user' });
    expect((error as ForegroundDetachedError).output).toContain('before');

    const later: string[] = [];
    adopted[0].pipe((chunk) => later.push(chunk.toString()));
    await expect(adopted[0].done).resolves.toBe(0);
    expect(later.join('')).toContain('after');
    expect(seen.join('')).not.toContain('after');
  });

  it('转后台后的 kill 终止进程', async () => {
    const { command, adopted, seen, run } = setup();
    const pending = run('echo go; sleep 30');
    await until(() => seen.join('').includes('go'));
    command.detach('user');
    await pending.catch(() => {});
    adopted[0].kill();
    await expect(adopted[0].done).rejects.toThrow('aborted');
  });

  it('默认超时转后台而不是杀进程', async () => {
    const { adopted, run } = setup('background');
    const error = await run('sleep 0.6; echo late', 0.2).catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: 'timeout', taskId: 'task-1' });
    await expect(adopted[0].done).resolves.toBe(0);
  });

  it('显式超时仍按 pi 约定杀进程并报 timeout', async () => {
    const { adopted, run } = setup('kill');
    await expect(run('sleep 5', 0.2)).rejects.toThrow('timeout:0.2');
    expect(adopted).toHaveLength(0);
  });

  it('显式超时的命令被用户转后台后不再受前台超时约束', async () => {
    const { command, adopted, seen, run } = setup('kill');
    const pending = run('echo go; sleep 0.5', 0.3);
    await until(() => seen.join('').includes('go'));
    command.detach('user');
    await pending.catch(() => {});
    await expect(adopted[0].done).resolves.toBe(0);
  });

  it('转后台被拒（配额满）时超时退回杀进程', async () => {
    const { run } = setup('background', new Error('full'));
    await expect(run('sleep 5', 0.2)).rejects.toThrow('timeout:0.2');
  });

  it('用户中止按 aborted 结束', async () => {
    const { controller, seen, run } = setup();
    const pending = run('echo go; sleep 30');
    await until(() => seen.join('').includes('go'));
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('命令结束后或尚未启动时 detach 返回 null', async () => {
    const { command, run } = setup();
    expect(command.detach('user')).toBeNull();
    await expect(run('exit 3')).resolves.toEqual({ exitCode: 3 });
    expect(command.detach('user')).toBeNull();
  });
});
