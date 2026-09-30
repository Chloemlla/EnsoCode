import { describe, expect, it } from 'vitest';
import {
  absoluteMouseCoords,
  INPUT_MOUSE,
  KEYEVENTF_KEYUP,
  KEYEVENTF_UNICODE,
  MOUSEEVENTF_ABSOLUTE,
  MOUSEEVENTF_RIGHTDOWN,
  MOUSEEVENTF_RIGHTUP,
  mouseButtonFlags,
  typeTextKeys,
  wheelSteps,
  writeMouseInput,
} from './winInput';

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

describe('mouseButtonFlags', () => {
  it('左/右/中键各有按下抬起标志，未知按键报错', () => {
    expect(mouseButtonFlags()).toEqual({ down: 0x2, up: 0x4 });
    expect(mouseButtonFlags('right')).toEqual({
      down: MOUSEEVENTF_RIGHTDOWN,
      up: MOUSEEVENTF_RIGHTUP,
    });
    expect(mouseButtonFlags('middle')).toEqual({ down: 0x20, up: 0x40 });
    expect(() => mouseButtonFlags('back')).toThrow(/button/);
  });
});

describe('wheelSteps', () => {
  it('像素换算成滚轮增量并按一格 120 拆开，保留方向', () => {
    expect(wheelSteps(0)).toEqual([]);
    expect(wheelSteps(100)).toEqual([120]);
    expect(wheelSteps(-250)).toEqual([-120, -120, -60]);
  });

  it('很小的非零滚动至少滚 1', () => {
    expect(wheelSteps(0.2)).toEqual([1]);
    expect(wheelSteps(-0.2)).toEqual([-1]);
  });
});

describe('typeTextKeys', () => {
  it('普通字符按 UTF-16 单元以 Unicode 注入，先按下再抬起', () => {
    expect(typeTextKeys('a你')).toEqual([
      { vk: 0, scan: 0x61, flags: KEYEVENTF_UNICODE },
      { vk: 0, scan: 0x61, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP },
      { vk: 0, scan: 0x4f60, flags: KEYEVENTF_UNICODE },
      { vk: 0, scan: 0x4f60, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP },
    ]);
  });

  it('emoji 拆成两个代理单元', () => {
    const scans = typeTextKeys('🙂').map((event) => event.scan);
    expect(scans).toEqual([0xd83d, 0xd83d, 0xde42, 0xde42]);
  });

  it('换行和 Tab 发真实按键，\\r\\n 只算一次回车', () => {
    expect(typeTextKeys('\r\n\t').map((event) => [event.vk, event.flags])).toEqual([
      [0x0d, 0],
      [0x0d, KEYEVENTF_KEYUP],
      [0x09, 0],
      [0x09, KEYEVENTF_KEYUP],
    ]);
  });
});
