export const INPUT_MOUSE = 0;
export const INPUT_KEYBOARD = 1;
export const INPUT_SIZE = 40;
export const MOUSEEVENTF_MOVE = 0x0001;
export const MOUSEEVENTF_LEFTDOWN = 0x0002;
export const MOUSEEVENTF_LEFTUP = 0x0004;
export const MOUSEEVENTF_RIGHTDOWN = 0x0008;
export const MOUSEEVENTF_RIGHTUP = 0x0010;
export const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
export const MOUSEEVENTF_MIDDLEUP = 0x0040;
export const MOUSEEVENTF_WHEEL = 0x0800;
export const MOUSEEVENTF_HWHEEL = 0x1000;
export const MOUSEEVENTF_ABSOLUTE = 0x8000;
export const MOUSEEVENTF_VIRTUALDESK = 0x4000;
export const KEYEVENTF_EXTENDEDKEY = 0x0001;
export const KEYEVENTF_KEYUP = 0x0002;
export const KEYEVENTF_UNICODE = 0x0004;
export const WHEEL_DELTA = 120;

export function absoluteMouseCoords(
  x: number,
  y: number,
  screen: { x: number; y: number; width: number; height: number }
): { dx: number; dy: number } {
  const width = Math.max(1, screen.width - 1);
  const height = Math.max(1, screen.height - 1);
  return {
    dx: Math.round(((x - screen.x) * 65535) / width),
    dy: Math.round(((y - screen.y) * 65535) / height),
  };
}

export function writeMouseInput(
  buf: Buffer,
  offset: number,
  dx: number,
  dy: number,
  flags: number,
  mouseData = 0
): void {
  buf.writeUInt32LE(INPUT_MOUSE, offset);
  buf.writeInt32LE(dx, offset + 8);
  buf.writeInt32LE(dy, offset + 12);
  buf.writeUInt32LE(mouseData >>> 0, offset + 16);
  buf.writeUInt32LE(flags >>> 0, offset + 20);
}

export function writeKeyboardInput(
  buf: Buffer,
  offset: number,
  vk: number,
  flags: number,
  scan = 0
): void {
  buf.writeUInt32LE(INPUT_KEYBOARD, offset);
  buf.writeUInt16LE(vk, offset + 8);
  buf.writeUInt16LE(scan, offset + 10);
  buf.writeUInt32LE(flags >>> 0, offset + 12);
}

export function mouseButtonFlags(button = 'left'): { down: number; up: number } {
  switch (button) {
    case 'left':
      return { down: MOUSEEVENTF_LEFTDOWN, up: MOUSEEVENTF_LEFTUP };
    case 'right':
      return { down: MOUSEEVENTF_RIGHTDOWN, up: MOUSEEVENTF_RIGHTUP };
    case 'middle':
      return { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP };
    default:
      throw new Error(`unsupported mouse button: ${button}`);
  }
}

/** 与 mac 一致按像素滚动：Chromium 一格（120）≈ 100px；正数向上/向右 */
export function wheelSteps(pixels: number): number[] {
  if (!pixels) return [];
  const sign = Math.sign(pixels);
  let rest = Math.max(1, Math.round(Math.abs(pixels) * 1.2));
  const steps: number[] = [];
  while (rest > 0) {
    const step = Math.min(WHEEL_DELTA, rest);
    steps.push(sign * step);
    rest -= step;
  }
  return steps;
}

export interface WinKeyEvent {
  vk: number;
  scan: number;
  flags: number;
}

const VK_RETURN = 0x0d;
const VK_TAB = 0x09;

/** 文本逐个 UTF-16 单元走 KEYEVENTF_UNICODE（不经过键盘布局/输入法）；换行和 Tab 发真实按键 */
export function typeTextKeys(text: string): WinKeyEvent[] {
  const events: WinKeyEvent[] = [];
  const press = (vk: number) => {
    events.push({ vk, scan: 0, flags: 0 }, { vk, scan: 0, flags: KEYEVENTF_KEYUP });
  };
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) i += 1;
      press(VK_RETURN);
    } else if (unit === 0x0a) press(VK_RETURN);
    else if (unit === 0x09) press(VK_TAB);
    else {
      events.push(
        { vk: 0, scan: unit, flags: KEYEVENTF_UNICODE },
        { vk: 0, scan: unit, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP }
      );
    }
  }
  return events;
}
