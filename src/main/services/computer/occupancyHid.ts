import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HID_SYSTEM_STATE = 1;
const ANY_INPUT_EVENT = 0xffffffff;

type HidFn = (state: number, eventType: number) => number;

let hidFn: HidFn | null | undefined;

function loadHidFn(): HidFn | null {
  if (process.platform !== 'darwin') return null;
  const koffi = require('koffi') as {
    load(path: string): { func(name: string, result: string, args: string[]): HidFn };
  };
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  return cg.func('CGEventSourceSecondsSinceLastEventType', 'double', ['int32', 'uint32']);
}

export function hidSecondsSinceLastEvent(): number {
  try {
    if (hidFn === undefined) hidFn = loadHidFn();
    if (!hidFn) return Number.POSITIVE_INFINITY;
    const seconds = hidFn(HID_SYSTEM_STATE, ANY_INPUT_EVENT);
    return typeof seconds === 'number' && Number.isFinite(seconds)
      ? seconds
      : Number.POSITIVE_INFINITY;
  } catch {
    hidFn = null;
    return Number.POSITIVE_INFINITY;
  }
}
