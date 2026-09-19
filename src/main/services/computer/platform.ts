import type { DesktopBackend } from './backend';
import { MacosDesktopBackend } from './macos';
import { UnsupportedDesktopBackend } from './unsupported';

export function createDesktopBackend(): DesktopBackend {
  if (process.platform === 'darwin') return new MacosDesktopBackend();
  return new UnsupportedDesktopBackend();
}
