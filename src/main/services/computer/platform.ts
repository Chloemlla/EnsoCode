import type { DesktopBackend } from './backend';
import { MacosDesktopBackend } from './macos';
import { UnsupportedDesktopBackend } from './unsupported';
import { WindowsDesktopBackend } from './win32';

export function createDesktopBackend(platform = process.platform): DesktopBackend {
  if (platform === 'darwin') return new MacosDesktopBackend();
  if (platform === 'win32') return new WindowsDesktopBackend();
  return new UnsupportedDesktopBackend(platform);
}
