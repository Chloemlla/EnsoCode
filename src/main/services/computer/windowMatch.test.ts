import type { ComputerWindowInfo } from '@shared/computer/types';
import { describe, expect, it } from 'vitest';
import { matchWindow, pickMatchedWindow, resolveWindow } from './windowMatch';

const wechat: ComputerWindowInfo = {
  id: '11',
  app: '微信',
  title: '微信',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};
const safari: ComputerWindowInfo = {
  id: 'w1',
  app: 'Safari',
  title: 'Settings',
  focused: true,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};
const safariOther: ComputerWindowInfo = {
  id: 'w2',
  app: 'Safari',
  title: 'Other',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

describe('windowMatch', () => {
  it('WeChat 别名命中微信，name/query 也可', () => {
    expect(matchWindow(wechat, { app: 'WeChat' })).toBe(true);
    expect(matchWindow(wechat, { name: 'wechat' })).toBe(true);
    expect(matchWindow(wechat, { query: '微信' })).toBe(true);
  });

  it('字符串先按 id，再按 app/title', () => {
    const all = [wechat, safari];
    expect(resolveWindow(all, '11')?.id).toBe('11');
    expect(resolveWindow(all, 'WeChat')?.app).toBe('微信');
    expect(resolveWindow(all, { app: 'Safari' })?.id).toBe('w1');
  });

  it('多窗口同 app 取 focused，而不是 ambiguous', () => {
    expect(pickMatchedWindow([safariOther, safari])?.id).toBe('w1');
    expect(resolveWindow([safariOther, safari], { app: 'Safari' })?.id).toBe('w1');
  });

  it('完全对不上才算没匹配', () => {
    expect(resolveWindow([safari], { app: 'WeChat' })).toBeUndefined();
  });
});
