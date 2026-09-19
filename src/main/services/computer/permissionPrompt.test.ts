import { describe, expect, it, vi } from 'vitest';
import { promptComputerPermission } from './permissionPrompt';

describe('promptComputerPermission', () => {
  it('屏幕已授权则不打开系统设置', async () => {
    const openSettings = vi.fn();
    const granted = await promptComputerPermission('screen', {
      requestScreen: async () => true,
      requestAx: () => false,
      openSettings,
    });
    expect(granted).toBe(true);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('屏幕未授权才打开系统设置', async () => {
    const openSettings = vi.fn();
    const granted = await promptComputerPermission('screen', {
      requestScreen: async () => false,
      requestAx: () => true,
      openSettings,
    });
    expect(granted).toBe(false);
    expect(openSettings).toHaveBeenCalledWith('screen');
  });

  it('辅助功能弹出当前进程 TCC，未授权才打开系统设置', async () => {
    const requestAx = vi.fn(() => false);
    const openSettings = vi.fn();
    await promptComputerPermission('accessibility', {
      requestScreen: async () => true,
      requestAx,
      openSettings,
    });
    expect(requestAx).toHaveBeenCalledWith(true);
    expect(openSettings).toHaveBeenCalledWith('accessibility');
  });
});
