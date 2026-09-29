import type { DesktopBackend } from './backend';
import { MacosDesktopBackend } from './macos';
import { isComputerPlatformSupported } from './support';
import { UnsupportedDesktopBackend } from './unsupported';
import { WindowsDesktopBackend } from './win32';

export { isComputerPlatformSupported } from './support';

export function createDesktopBackend(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env
): DesktopBackend {
  if (!isComputerPlatformSupported(platform, env)) return new UnsupportedDesktopBackend(platform);
  return platform === 'darwin' ? new MacosDesktopBackend() : new WindowsDesktopBackend();
}
