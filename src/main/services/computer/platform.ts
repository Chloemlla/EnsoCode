import type { DesktopBackend } from './backend';
import { MacosDesktopBackend } from './macos';
import { isComputerPlatformSupported } from './support';
import { UnsupportedDesktopBackend } from './unsupported';
import { WindowsDesktopBackend } from './win32';

export { isComputerPlatformSupported } from './support';

export function createDesktopBackend(platform: string = process.platform): DesktopBackend {
  if (!isComputerPlatformSupported(platform)) return new UnsupportedDesktopBackend(platform);
  return platform === 'darwin' ? new MacosDesktopBackend() : new WindowsDesktopBackend();
}
