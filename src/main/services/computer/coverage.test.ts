import { describe, expect, it } from 'vitest';
import { hiddenBehindOthers } from './coverage';

const win = (id: string, x: number, y: number, width: number, height: number) => ({
  id,
  app: id,
  title: '',
  x,
  y,
  width,
  height,
});

describe('hiddenBehindOthers', () => {
  it('前面的窗口合起来盖住目标才算被遮挡', () => {
    const target = win('t', 100, 100, 400, 300);
    expect(hiddenBehindOthers([win('a', 0, 0, 1000, 1000), target], 't')).toBe(true);
    expect(
      hiddenBehindOthers([win('a', 0, 0, 300, 1000), win('b', 300, 0, 700, 1000), target], 't')
    ).toBe(true);
    expect(hiddenBehindOthers([win('a', 0, 0, 300, 1000), target], 't')).toBe(false);
  });

  it('目标在最前、在后面的窗口、或找不到目标都不算', () => {
    const target = win('t', 100, 100, 400, 300);
    expect(hiddenBehindOthers([target, win('a', 0, 0, 1000, 1000)], 't')).toBe(false);
    expect(hiddenBehindOthers([win('a', 0, 0, 1000, 1000)], 't')).toBe(false);
    expect(hiddenBehindOthers([win('a', 0, 0, 1000, 1000), win('t', 0, 0, 0, 0)], 't')).toBe(false);
  });
});
