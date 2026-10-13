import { describe, expect, it } from 'vitest';
import { splitTaskRef } from './progress';

describe('splitTaskRef', () => {
  it('切出第一个 #N，前后文本保留', () => {
    expect(splitTaskRef('开工 #3『登录页』', 3)).toEqual(['开工 ', '#3', '『登录页』']);
    expect(splitTaskRef('#12 卡住了，缺：地址 @Boss', 12)).toEqual([
      '',
      '#12',
      ' 卡住了，缺：地址 @Boss',
    ]);
    expect(splitTaskRef('交付 #3：完成 #3 的登录', 3)).toEqual(['交付 ', '#3', '：完成 #3 的登录']);
  });

  it('不把 #30 / #13 当成 #3', () => {
    expect(splitTaskRef('开工 #30', 3)).toBeUndefined();
    expect(splitTaskRef('交付 #13：ok', 3)).toBeUndefined();
    expect(splitTaskRef('见 #13 和 #3', 3)).toEqual(['见 #13 和 ', '#3', '']);
  });

  it('没有 #N 返回 undefined', () => {
    expect(splitTaskRef('交付', 3)).toBeUndefined();
    expect(splitTaskRef('', 3)).toBeUndefined();
  });
});
