import { describe, expect, it } from 'vitest';
import { resolveWinKey, splitWinChord } from './winKey';

describe('resolveWinKey', () => {
  it('字母、数字和修饰键映射成 VK', () => {
    expect(resolveWinKey('a')).toEqual({ code: 0x41, modifier: false, extended: false });
    expect(resolveWinKey('7')).toEqual({ code: 0x37, modifier: false, extended: false });
    expect(resolveWinKey('Enter')).toEqual({ code: 0x0d, modifier: false, extended: false });
    expect(resolveWinKey('ctrl')).toEqual({ code: 0x11, modifier: true, extended: false });
    expect(resolveWinKey('win')).toEqual({ code: 0x5b, modifier: true, extended: true });
  });

  it('mac 习惯的 cmd 在 Windows 上是 Ctrl，option 是 Alt', () => {
    expect(resolveWinKey('cmd').code).toBe(0x11);
    expect(resolveWinKey('command').code).toBe(0x11);
    expect(resolveWinKey('option').code).toBe(0x12);
  });

  it('方向键、翻页、F 键和标点都有映射，导航键带扩展位', () => {
    expect(resolveWinKey('left')).toEqual({ code: 0x25, modifier: false, extended: true });
    expect(resolveWinKey('ArrowDown')).toEqual({ code: 0x28, modifier: false, extended: true });
    expect(resolveWinKey('pagedown')).toEqual({ code: 0x22, modifier: false, extended: true });
    expect(resolveWinKey('home').code).toBe(0x24);
    expect(resolveWinKey('F5')).toEqual({ code: 0x74, modifier: false, extended: false });
    expect(resolveWinKey('f12').code).toBe(0x7b);
    expect(resolveWinKey('del')).toEqual({ code: 0x2e, modifier: false, extended: true });
    expect(resolveWinKey('backspace').code).toBe(0x08);
    expect(resolveWinKey('/').code).toBe(0xbf);
    expect(resolveWinKey('=').code).toBe(0xbb);
    expect(resolveWinKey('[').code).toBe(0xdb);
  });

  it('不认识的键返回 undefined', () => {
    expect(resolveWinKey('hyper').code).toBeUndefined();
  });
});

describe('splitWinChord', () => {
  it('ctrl+c 拆成修饰键 + 主键', () => {
    expect(splitWinChord(['ctrl', 'c'])).toEqual({
      modifiers: [{ vk: 0x11, extended: false }],
      keys: [{ vk: 0x43, extended: false }],
      unmapped: [],
    });
  });

  it('不认识的键单独列出，不静默丢掉', () => {
    expect(splitWinChord(['ctrl', 'hyper']).unmapped).toEqual(['hyper']);
  });
});
