import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HID_SYSTEM_STATE = 1;
const ANY_INPUT_EVENT = 0xffffffff;

type HidFn = (state: number, eventType: number) => number;

/** GetTickCount 与 LASTINPUTINFO.dwTime 都是 32 位毫秒计数，约 49.7 天回绕 */
export function secondsSinceTick(now: number, last: number): number {
  return ((now - last) >>> 0) / 1000;
}

type Koffi = {
  load(path: string): {
    func(name: string, result: string, args: string[]): (...args: unknown[]) => unknown;
  };
};

// GetLastInputInfo 同样计入 SendInput 注入的事件，与 mac 一样靠 occupancy 的合成输入窗口排除
function loadWinLastInput(koffi: Koffi): HidFn {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const GetLastInputInfo = user32.func('GetLastInputInfo', 'int', ['void *']);
  const GetTickCount = kernel32.func('GetTickCount', 'uint32', []);
  const info = Buffer.alloc(8);
  return () => {
    info.writeUInt32LE(8, 0);
    if (!GetLastInputInfo(info)) return Number.NaN;
    return secondsSinceTick(Number(GetTickCount()), info.readUInt32LE(4));
  };
}

function loadHidFn(): HidFn | null {
  if (process.platform === 'win32') return loadWinLastInput(require('koffi') as Koffi);
  if (process.platform !== 'darwin') return null;
  const koffi = require('koffi') as {
    load(path: string): { func(name: string, result: string, args: string[]): HidFn };
  };
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  return cg.func('CGEventSourceSecondsSinceLastEventType', 'double', ['int32', 'uint32']);
}

/** null = 无法检测物理输入（平台不支持或原生加载失败），不可当作空闲。 */
export function createHidProbe(load: () => HidFn | null): () => number | null {
  let hidFn: HidFn | null | undefined;
  return () => {
    try {
      if (hidFn === undefined) hidFn = load();
      if (!hidFn) return null;
      const seconds = hidFn(HID_SYSTEM_STATE, ANY_INPUT_EVENT);
      return typeof seconds === 'number' && !Number.isNaN(seconds) ? seconds : null;
    } catch (error) {
      if (hidFn === undefined) console.warn('[computer] HID idle probe unavailable', error);
      hidFn = null;
      return null;
    }
  };
}

export const hidSecondsSinceLastEvent = createHidProbe(loadHidFn);
