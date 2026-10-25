import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installIpcRegistry, registeredHandler, registeredListeners } from './ipcRegistry';

class FakeIpc extends EventEmitter {
  handled = new Map<string, unknown>();
  handle(channel: string, handler: unknown) {
    if (this.handled.has(channel)) throw new Error('dup');
    this.handled.set(channel, handler);
  }
  removeHandler(channel: string) {
    this.handled.delete(channel);
  }
}

describe('ipc registry', () => {
  it('mirrors handle/on registrations without changing ipcMain behavior', () => {
    const ipc = new FakeIpc();
    installIpcRegistry(ipc as never);
    const handler = () => 1;
    ipc.handle('a', handler);
    expect(registeredHandler('a')).toBe(handler);
    expect(() => ipc.handle('a', handler)).toThrow('dup');
    ipc.removeHandler('a');
    expect(registeredHandler('a')).toBeUndefined();

    const seen: unknown[] = [];
    const listener = (_e: unknown, v: unknown) => seen.push(v);
    ipc.on('b', listener);
    ipc.emit('b', {}, 1);
    expect(registeredListeners('b')).toEqual([listener]);
    ipc.once('b', listener);
    ipc.emit('b', {}, 2);
    expect(registeredListeners('b')).toEqual([listener]);
    ipc.removeListener('b', listener);
    expect(registeredListeners('b')).toEqual([]);
    expect(seen).toEqual([1, 2, 2]);
  });
});
