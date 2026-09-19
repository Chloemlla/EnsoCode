interface KoffiLib {
  func(name: string, ret: string, args: unknown[]): () => boolean;
}

/** Blocks on the macOS Screen Recording TCC dialog. Adds this process to System Settings. */
export async function requestScreenCaptureAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    const koffi = (await import('koffi')).default as { load(path: string): KoffiLib };
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    const preflight = cg.func('CGPreflightScreenCaptureAccess', 'bool', []);
    if (preflight()) return true;
    const request = cg.func('CGRequestScreenCaptureAccess', 'bool', []);
    return Boolean(request());
  } catch {
    return false;
  }
}
