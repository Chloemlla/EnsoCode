import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
  desktopCapturer: { getSources: vi.fn(async () => []) },
  screen: {
    getAllDisplays: () => [],
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
  },
  clipboard: { readText: () => '', writeText: () => {} },
  systemPreferences: {
    getMediaAccessStatus: () => 'granted',
    isTrustedAccessibilityClient: () => true,
  },
}));

vi.mock('./axWorkerThread?modulePath', () => ({ default: '/tmp/ax-worker.js' }));

import { MacosDesktopBackend } from './macos';
import { createDesktopBackend, isComputerPlatformSupported } from './platform';
import { UnsupportedDesktopBackend } from './unsupported';
import { WindowsDesktopBackend } from './win32';

describe('createDesktopBackend', () => {
  it('本版只有 macOS 默认可用，Windows 需显式开启实验开关', () => {
    expect(createDesktopBackend('darwin', {})).toBeInstanceOf(MacosDesktopBackend);
    expect(createDesktopBackend('win32', {})).toBeInstanceOf(UnsupportedDesktopBackend);
    expect(createDesktopBackend('linux', {})).toBeInstanceOf(UnsupportedDesktopBackend);
    const experimental = { ENSO_EXPERIMENTAL_COMPUTER_WINDOWS: '1' };
    expect(createDesktopBackend('win32', experimental)).toBeInstanceOf(WindowsDesktopBackend);
    expect(isComputerPlatformSupported('darwin', {})).toBe(true);
    expect(isComputerPlatformSupported('win32', {})).toBe(false);
    expect(isComputerPlatformSupported('win32', experimental)).toBe(true);
    expect(isComputerPlatformSupported('linux', experimental)).toBe(false);
  });

  it('Windows（实验）能截图，但还没有 AX', async () => {
    const caps = await createDesktopBackend('win32', {
      ENSO_EXPERIMENTAL_COMPUTER_WINDOWS: '1',
    }).capabilities();
    expect(caps.platform).toBe('win32');
    expect(caps.capture).toBe(true);
    expect(caps.ax).toBe(false);
  });
});
