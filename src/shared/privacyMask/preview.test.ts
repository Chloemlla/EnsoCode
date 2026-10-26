import { describe, expect, it } from 'vitest';
import { previewMask, scanUserInput } from './preview';
import { DEFAULT_PRIVACY_MASK_SETTINGS, type PrivacyMaskSettings } from './settings';

const KEY = 'sk-proj-AbCdEfGh1234567890IjKlMnOp';
const on = (patch: Partial<PrivacyMaskSettings> = {}): PrivacyMaskSettings => ({
  ...DEFAULT_PRIVACY_MASK_SETTINGS,
  enabled: true,
  ...patch,
});

describe('privacy mask preview', () => {
  it('masks without remembering across calls', () => {
    const a = previewMask(`k ${KEY}`, on());
    expect(a.text).toMatch(/^k \{\{API_KEY_[a-z2-7]{8}\}\}$/);
    expect(a.report.hits).toHaveLength(1);
    expect(previewMask('nothing here', on()).report.hits).toEqual([]);
  });

  it('scans composer input for mask and block counts', () => {
    expect(scanUserInput(`k ${KEY}`, on({ enabled: false }))).toEqual({ masked: 0, blocked: [] });
    expect(scanUserInput(`k ${KEY}`, on())).toEqual({ masked: 1, blocked: [] });
    expect(
      scanUserInput(`k ${KEY}`, on({ secrets: { enabled: true, action: 'block', shape: false } }))
    ).toEqual({ masked: 0, blocked: ['API_KEY'] });
  });
});
