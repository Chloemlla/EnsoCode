import { describe, expect, it } from 'vitest';
import { INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, absoluteMouseCoords, writeMouseInput } from './winInput';

describe('absoluteMouseCoords', () => {
  it('把屏幕坐标映射到 0..65535 虚拟桌面', () => {
    expect(absoluteMouseCoords(0, 0, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual({
      dx: 0,
      dy: 0,
    });
    expect(absoluteMouseCoords(1919, 1079, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual({
      dx: 65535,
      dy: 65535,
    });
  });
});

describe('writeMouseInput', () => {
  it('x64 INPUT 在 offset 8 写鼠标字段', () => {
    const buf = Buffer.alloc(40);
    writeMouseInput(buf, 0, 100, 200, MOUSEEVENTF_ABSOLUTE);
    expect(buf.readUInt32LE(0)).toBe(INPUT_MOUSE);
    expect(buf.readInt32LE(8)).toBe(100);
    expect(buf.readInt32LE(12)).toBe(200);
    expect(buf.readUInt32LE(20)).toBe(MOUSEEVENTF_ABSOLUTE);
  });
});
