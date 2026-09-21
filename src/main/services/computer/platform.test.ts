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
import { createDesktopBackend } from './platform';
import { UnsupportedDesktopBackend } from './unsupported';
import { WindowsDesktopBackend } from './win32';

describe('createDesktopBackend', () => {
  it('win32 走 Windows backend，不再是 unsupported', () => {
    expect(createDesktopBackend('win32')).toBeInstanceOf(WindowsDesktopBackend);
    expect(createDesktopBackend('darwin')).toBeInstanceOf(MacosDesktopBackend);
    expect(createDesktopBackend('linux')).toBeInstanceOf(UnsupportedDesktopBackend);
  });

  it('Windows 能截图，但还没有 AX', async () => {
    const caps = await createDesktopBackend('win32').capabilities();
    expect(caps.platform).toBe('win32');
    expect(caps.capture).toBe(true);
    expect(caps.ax).toBe(false);
  });
});
