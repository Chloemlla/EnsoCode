import type { IpcEvent, IpcInvokeEvent } from '@platform';

type Handler = (event: IpcInvokeEvent, ...args: unknown[]) => unknown;
type Listener = (event: IpcEvent, ...args: unknown[]) => void;

interface IpcMainLike {
  handle(channel: string, handler: Handler): void;
  removeHandler(channel: string): void;
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
  off(channel: string, listener: Listener): unknown;
  removeAllListeners(channel?: string): unknown;
}

const handlers = new Map<string, Handler>();
const listeners = new Map<string, Set<Listener>>();
let installed = false;

/**
 * 镜像 ipcMain 的注册表，让远程 renderer 的调用走同一批 handler。
 * 必须在任何 handler 注册之前安装。
 */
export function installIpcRegistry(ipc: IpcMainLike): void {
  if (installed) return;
  installed = true;
  const handle = ipc.handle.bind(ipc);
  const removeHandler = ipc.removeHandler.bind(ipc);
  const on = ipc.on.bind(ipc);
  const removeListener = ipc.removeListener.bind(ipc);
  const removeAllListeners = ipc.removeAllListeners.bind(ipc);
  ipc.handle = (channel, handler) => {
    handle(channel, handler);
    handlers.set(channel, handler);
  };
  ipc.removeHandler = (channel) => {
    removeHandler(channel);
    handlers.delete(channel);
  };
  ipc.on = (channel, listener) => {
    const result = on(channel, listener);
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    set.add(listener);
    return result;
  };
  const drop = (channel: string, listener: Listener) => {
    const result = removeListener(channel, listener);
    listeners.get(channel)?.delete(listener);
    return result;
  };
  ipc.removeListener = drop;
  ipc.off = drop;
  ipc.removeAllListeners = (channel?: string) => {
    const result = removeAllListeners(channel);
    if (channel === undefined) listeners.clear();
    else listeners.delete(channel);
    return result;
  };
}

export function registeredHandler(channel: string): Handler | undefined {
  return handlers.get(channel);
}

export function registeredListeners(channel: string): Listener[] {
  return [...(listeners.get(channel) ?? [])];
}
