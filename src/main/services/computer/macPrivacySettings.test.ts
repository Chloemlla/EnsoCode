import { describe, expect, it, vi } from 'vitest';
import { macPrivacySettingsUrls, openMacPrivacySettings } from './macPrivacySettings';

describe('macPrivacySettingsUrls', () => {
  it('给出新旧两套辅助功能深链', () => {
    expect(macPrivacySettingsUrls('accessibility')).toEqual([
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    ]);
  });

  it('给出新旧两套屏幕录制深链', () => {
    expect(macPrivacySettingsUrls('screen')).toEqual([
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    ]);
  });
});

describe('openMacPrivacySettings', () => {
  it('第一条深链成功就停', async () => {
    const openUrl = vi.fn(async () => {});
    await openMacPrivacySettings('accessibility', openUrl);
    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(macPrivacySettingsUrls('accessibility')[0]);
  });

  it('第一条失败则试旧链', async () => {
    const openUrl = vi.fn(async (url: string) => {
      if (url.includes('PrivacySecurity.extension')) throw new Error('nope');
    });
    await openMacPrivacySettings('screen', openUrl);
    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(openUrl).toHaveBeenLastCalledWith(macPrivacySettingsUrls('screen')[1]);
  });
});
