/** Windows 后端尚未经真机验证，本版仅在显式开启实验开关时启用 */
export const COMPUTER_WINDOWS_FLAG = 'ENSO_EXPERIMENTAL_COMPUTER_WINDOWS';

export function isComputerPlatformSupported(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (platform === 'darwin') return true;
  return platform === 'win32' && env[COMPUTER_WINDOWS_FLAG] === '1';
}
