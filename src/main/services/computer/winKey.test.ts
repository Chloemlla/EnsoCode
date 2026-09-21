import { describe, expect, it } from 'vitest';
import { resolveWinKey, splitWinChord } from './winKey';

describe('resolveWinKey', () => {
  it('字母和修饰键映射成 VK', () => {
    expect(resolveWinKey('a')).toEqual({ code: 0x41, modifier: false });
    expect(resolveWinKey('Enter')).toEqual({ code: 0x0d, modifier: false });
    expect(resolveWinKey('ctrl')).toEqual({ code: 0x11, modifier: true });
    expect(resolveWinKey('meta')).toEqual({ code: 0x5b, modifier: true });
  });
});

describe('splitWinChord', () => {
  it('ctrl+c 拆成修饰键 + 主键', () => {
    expect(splitWinChord(['ctrl', 'c'])).toEqual({
      modifiers: [0x11],
      keys: [0x43],
    });
  });
});
