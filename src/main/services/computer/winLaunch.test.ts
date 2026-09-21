import { describe, expect, it } from 'vitest';
import { resolveWinLaunch, resolveWinSettingsPane } from './winLaunch';

describe('resolveWinSettingsPane', () => {
  it('外观打开颜色设置页', () => {
    expect(resolveWinSettingsPane('外观')).toBe('ms-settings:colors');
    expect(resolveWinSettingsPane('lock screen')).toBe('ms-settings:lockscreen');
  });
});

describe('resolveWinLaunch', () => {
  it('系统设置走 ms-settings', () => {
    expect(resolveWinLaunch('系统设置')).toEqual({ target: 'ms-settings:', app: false });
    expect(resolveWinLaunch('notepad')).toEqual({ target: 'notepad', app: true });
  });
});
