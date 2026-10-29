import { describe, expect, it, vi } from 'vitest';

/**
 * 主窗口 UI 跑在独立的 WebContentsView 里，`win.webContents` 只是没有 preload 的空壳。
 * 核心层经 LocalUi 广播，必须拿到 getWindowWebContents(win) 解析出的 UI webContents。
 */
const mocks = vi.hoisted(() => {
  const shell = { id: 1, isDestroyed: () => false, send: vi.fn() };
  const ui = { id: 2, isDestroyed: () => false, send: vi.fn() };
  const win = { isDestroyed: () => false, isFocused: () => false, webContents: shell };
  return { shell, ui, win };
});

vi.mock('electron', () => ({
  app: { on: vi.fn(), isPackaged: false },
  BrowserWindow: { getAllWindows: () => [mocks.win] },
  session: { fromPartition: vi.fn() },
  webContents: { getAllWebContents: () => [] },
}));
vi.mock('../windows/createAppWindow', () => ({ getWindowWebContents: () => mocks.ui }));
vi.mock('../windows/MainWindow', () => ({
  getMainWindow: () => mocks.win,
  focusMainWindow: vi.fn(),
}));
vi.mock('../windows/SettingsWindow', () => ({ getSettingsWindow: () => null }));
vi.mock('../services/appServerMode', () => ({ isServerMode: () => false }));

describe('desktop LocalUi', () => {
  it('resolves windows to their UI webContents, not the shell', async () => {
    const { installDesktopLocalUi } = await import('./localUi');
    const { broadcastToRenderers, isMainRenderer, sendToLocalMain } = await import(
      '../services/renderers'
    );
    installDesktopLocalUi();

    broadcastToRenderers('ch:all', 1);
    sendToLocalMain('ch:main', 2);

    expect(mocks.ui.send).toHaveBeenCalledWith('ch:all', 1);
    expect(mocks.ui.send).toHaveBeenCalledWith('ch:main', 2);
    expect(mocks.shell.send).not.toHaveBeenCalled();
    expect(isMainRenderer(mocks.ui.id)).toBe(true);
    expect(isMainRenderer(mocks.shell.id)).toBe(false);
  });
});
