import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HID_SYSTEM_STATE = 1;
const ANY_INPUT_EVENT = 0xffffffff;

type HidFn = (state: number, eventType: number) => number;

function loadHidFn(): HidFn | null {
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
