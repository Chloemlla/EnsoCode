import { describe, expect, it } from 'vitest';
import {
  macEventFlags,
  macKeyForAsciiChar,
  resolveMacKey,
  splitMacChord,
  splitTypeSegments,
} from './macKey';

describe('resolveMacKey', () => {
  it('Meta/Command 是修饰键 55，不会落到字母 a（0）', () => {
    expect(resolveMacKey('Meta')).toEqual({ code: 55, modifier: true });
    expect(resolveMacKey('cmd')).toEqual({ code: 55, modifier: true });
    expect(resolveMacKey('a')).toEqual({ code: 0, modifier: false });
  });

  it('未知键不映射成 a', () => {
    expect(resolveMacKey('F19')).toEqual({ code: undefined, modifier: false });
  });
});

describe('macEventFlags', () => {
  it('Meta+a 带 Command 标志，单独 a 不带', () => {
    expect(macEventFlags(['Meta', 'a'])).toBe(0x00100000);
    expect(macEventFlags(['a'])).toBe(0);
  });

  it('shift+ctrl+option 可叠加', () => {
    expect(macEventFlags(['shift', 'ctrl', 'option'])).toBe(0x00020000 | 0x00040000 | 0x00080000);
  });
});

describe('splitMacChord', () => {
  it('Meta+a 拆成修饰键 55 和字母 0，并带 Command 标志', () => {
    expect(splitMacChord(['Meta', 'a'])).toEqual({
      modifiers: [55],
      keys: [0],
      flags: 0x00100000,
    });
  });
});

describe('splitTypeSegments', () => {
  it('拉丁字母和汉字分段，拉丁不走 Unicode', () => {
    expect(splitTypeSegments('nihao 你好')).toEqual([
      { kind: 'ascii', text: 'nihao ' },
      { kind: 'unicode', text: '你好' },
    ]);
  });
});

describe('macKeyForAsciiChar', () => {
  it('n 是键码 45，N 带 Shift', () => {
    expect(macKeyForAsciiChar('n')).toEqual({ code: 45, flags: 0 });
    expect(macKeyForAsciiChar('N')).toEqual({ code: 45, flags: 0x00020000 });
  });
});
