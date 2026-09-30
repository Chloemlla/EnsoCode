export function isComputerPlatformSupported(platform: string = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}
