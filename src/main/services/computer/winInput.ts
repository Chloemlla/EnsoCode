export const INPUT_MOUSE = 0;
export const INPUT_KEYBOARD = 1;
export const INPUT_SIZE = 40;
export const MOUSEEVENTF_MOVE = 0x0001;
export const MOUSEEVENTF_LEFTDOWN = 0x0002;
export const MOUSEEVENTF_LEFTUP = 0x0004;
export const MOUSEEVENTF_WHEEL = 0x0800;
export const MOUSEEVENTF_HWHEEL = 0x1000;
export const MOUSEEVENTF_ABSOLUTE = 0x8000;
export const MOUSEEVENTF_VIRTUALDESK = 0x4000;
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
