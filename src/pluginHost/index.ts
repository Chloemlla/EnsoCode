import type { PluginHostToMain } from '@shared/extensionPlugins/protocol';
import { runPluginHost } from './host';

/** 桌面走 utilityProcess 的 parentPort，服务端走 child_process 的 IPC */
const parentPort = (
  process as unknown as { parentPort?: NodeJS.EventEmitter & { postMessage(m: unknown): void } }
).parentPort;

runPluginHost({
  send: (message: PluginHostToMain) => {
    if (parentPort) parentPort.postMessage(message);
    else process.send?.(message);
  },
  onMessage: (handler) => {
    if (parentPort) parentPort.on('message', (event: { data: unknown }) => handler(event.data));
    else process.on('message', handler);
  },
});

process.on('uncaughtException', (error) => {
  const message: PluginHostToMain = {
    t: 'log',
    level: 'error',
    message: error.stack ?? String(error),
  };
  if (parentPort) parentPort.postMessage(message);
  else process.send?.(message);
  process.exit(1);
});
