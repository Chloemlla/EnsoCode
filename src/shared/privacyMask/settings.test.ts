import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY_MASK_SETTINGS, parsePrivacyMaskSettings } from './settings';

describe('privacy mask settings', () => {
  it('defaults to disabled', () => {
    expect(parsePrivacyMaskSettings(undefined)).toEqual(DEFAULT_PRIVACY_MASK_SETTINGS);
    expect(DEFAULT_PRIVACY_MASK_SETTINGS.enabled).toBe(false);
  });

  it('normalizes dirty input field by field', () => {
    const parsed = parsePrivacyMaskSettings({
      enabled: true,
      secrets: { enabled: 'yes', action: 'block', shape: true },
      personal: { enabled: true, action: 'nuke', kinds: ['email', 'bogus', 'email', 'ip'] },
      custom: { words: ['  Acme ', '', 3, 'Acme'], rules: ['/x+/i'], action: 'warn' },
      allow: ['a@b.com', null],
    });
    expect(parsed).toEqual({
      enabled: true,
      secrets: { enabled: true, action: 'block', shape: true },
      personal: { enabled: true, action: 'mask', kinds: ['email', 'ip'] },
      custom: { words: ['Acme'], rules: ['/x+/i'], action: 'warn' },
      allow: ['a@b.com'],
    });
  });

  it('rejects non-object input', () => {
    expect(parsePrivacyMaskSettings('on')).toEqual(DEFAULT_PRIVACY_MASK_SETTINGS);
    expect(parsePrivacyMaskSettings([])).toEqual(DEFAULT_PRIVACY_MASK_SETTINGS);
  });
});
