import { EventEmitter } from 'node:events';
import { IPC_CHANNELS } from '@shared/types';
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: new EventEmitter(), ipcMain: new EventEmitter() }));
vi.mock('./updater/AutoUpdater', () => ({
  autoUpdaterService: { isQuittingForUpdate: () => false },
}));

import { app, ipcMain } from 'electron';
import { attachAppCloseConfirm } from './appCloseConfirm';

describe('app close confirmation visibility', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    app.removeAllListeners();
    ipcMain.removeAllListeners();
  });

  it.each(['close', 'before-quit'] as const)(
    'brings the confirmation host above settings on %s',
    (eventName) => {
      let focused = 'settings';
      const win = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        isMinimized: () => false,
        restore: vi.fn(),
        show: vi.fn(),
        focus: () => {
          focused = 'main';
        },
      });
      const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false });
      const send = vi.fn(() => focused);
      attachAppCloseConfirm(win, send, () => contents as unknown as WebContents, {
        interceptBeforeQuit: true,
        onTray: vi.fn(),
      });

      const preventDefault = vi.fn();
      (eventName === 'close' ? win : app).emit(eventName, { preventDefault });

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(focused).toBe('main');
      expect(send).toHaveBeenCalledWith(IPC_CHANNELS.APP_CLOSE_REQUEST, expect.any(String));
      expect(send).toHaveReturnedWith('main');
      expect(win.restore).not.toHaveBeenCalled();
      win.emit('closed');
    }
  );

  it('restores and shows a minimized hidden host before requesting confirmation', () => {
    let minimized = true;
    let visible = false;
    let focused = false;
    const win = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      restore: () => {
        minimized = false;
      },
      show: () => {
        visible = true;
      },
      focus: () => {
        focused = visible && !minimized;
      },
    });
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false });
    const send = vi.fn();
    attachAppCloseConfirm(win, send, () => contents as unknown as WebContents, {
      interceptBeforeQuit: true,
      onTray: vi.fn(),
    });

    app.emit('before-quit', { preventDefault: vi.fn() });

    expect({ minimized, visible, focused }).toEqual({
      minimized: false,
      visible: true,
      focused: true,
    });
    expect(send).toHaveBeenCalledOnce();
    win.emit('closed');
  });
});
