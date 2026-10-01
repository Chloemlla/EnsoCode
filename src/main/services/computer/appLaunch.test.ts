import { describe, expect, it } from 'vitest';
import { resolveOpenArgs, resolveSettingsPaneUrl } from './appLaunch';

describe('resolveOpenArgs', () => {
  it('系统设置走 bundle id，不把本地化名传给 open -a', () => {
    expect(resolveOpenArgs('系统设置')).toEqual(['-b', 'com.apple.systempreferences']);
    expect(resolveOpenArgs('System Settings')).toEqual(['-b', 'com.apple.systempreferences']);
    expect(resolveOpenArgs('System Preferences')).toEqual(['-b', 'com.apple.systempreferences']);
  });

  it('访达走 Finder bundle', () => {
    expect(resolveOpenArgs('访达')).toEqual(['-b', 'com.apple.finder']);
    expect(resolveOpenArgs('Finder')).toEqual(['-b', 'com.apple.finder']);
  });

  it('未知应用仍 open -a 原名', () => {
    expect(resolveOpenArgs('Safari')).toEqual(['-a', 'Safari']);
  });

  it('系统设置 pane 走 appearance URL', () => {
    expect(resolveSettingsPaneUrl('外观')).toMatch(/Appearance-Settings/);
    expect(resolveSettingsPaneUrl('Appearance')).toMatch(/Appearance-Settings/);
    expect(resolveSettingsPaneUrl('锁屏')).toMatch(/Lock-Screen-Settings/);
    expect(resolveSettingsPaneUrl('Lock Screen')).toMatch(/Lock-Screen-Settings/);
    expect(resolveSettingsPaneUrl('电池')).toMatch(/Battery-Settings/);
    expect(resolveSettingsPaneUrl('nope')).toBeUndefined();
  });
});
