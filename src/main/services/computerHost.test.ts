import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
  desktopCapturer: { getSources: vi.fn(async () => []) },
  screen: { getAllDisplays: () => [] },
  clipboard: { readText: () => '', writeText: () => {} },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(() => 'granted'),
    isTrustedAccessibilityClient: vi.fn(() => true),
  },
}));

import { desktopCapturer, shell, systemPreferences } from 'electron';
import { FakeDesktopBackend } from './computer/fakeBackend';
import { ComputerHost } from './computerHost';

vi.mock('./computer/screenCaptureAccess', () => ({
  requestScreenCaptureAccess: vi.fn(async () => false),
}));

describe('ComputerHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('run 执行 guest，frames 在同会话后续调用里仍在', async () => {
    const backend = new FakeDesktopBackend();
    const host = new ComputerHost(() => backend);
    await host.invoke('s1', 'run', {
      code: 'const win = await desktop.window("w1"); await win.screenshot();',
    });
    await host.invoke('s1', 'run', {
      code: 'const win = await desktop.window("w1"); await win.click(10, 5);',
    });
    expect(backend.clicks).toHaveLength(1);
    host.close('s1');
    await expect(
      host.invoke('s1', 'run', {
        code: 'const win = await desktop.window("w1"); await win.click(10, 5);',
      })
    ).rejects.toThrow(/screenshot/);
  });

  it('缺 code 拒绝', async () => {
    const host = new ComputerHost(() => new FakeDesktopBackend());
    await expect(host.invoke('s1', 'run', {})).rejects.toThrow(/code/);
  });

  it('打开辅助功能设置时向当前进程弹出 TCC', async () => {
    const host = new ComputerHost(() => new FakeDesktopBackend());
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false);
    await host.openPermissionSettings('accessibility');
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    expect(shell.openExternal).toHaveBeenCalled();
  });

  it('辅助功能已授权则不打开系统设置', async () => {
    const host = new ComputerHost(() => new FakeDesktopBackend());
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);
    await host.openPermissionSettings('accessibility');
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('打开屏幕录制设置时触发当前进程的截屏 TCC', async () => {
    const host = new ComputerHost(() => new FakeDesktopBackend());
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');
    await host.openPermissionSettings('screen');
    expect(desktopCapturer.getSources).toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalled();
  });
});
