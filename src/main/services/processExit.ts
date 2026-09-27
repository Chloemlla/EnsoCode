interface KillableChild {
  kill(): boolean;
  once(event: 'exit', listener: () => void): unknown;
}

/** 发终止信号并等退出；超时放行，不让一个不响应的子进程卡住应用退出 */
export function killAndWaitExit(child: KillableChild, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}
