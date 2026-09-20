import { describe, expect, it } from 'vitest';
import { isReadOnlyAllowed } from './readOnly';

describe('isReadOnlyAllowed', () => {
  it('允许观察，拒绝键鼠和写剪贴板', () => {
    expect(isReadOnlyAllowed('windows')).toBe(true);
    expect(isReadOnlyAllowed('screenshot')).toBe(true);
    expect(isReadOnlyAllowed('ax')).toBe(true);
    expect(isReadOnlyAllowed('clipboard.read')).toBe(true);
    expect(isReadOnlyAllowed('getState')).toBe(true);
    expect(isReadOnlyAllowed('app')).toBe(true);
    expect(isReadOnlyAllowed('click')).toBe(false);
    expect(isReadOnlyAllowed('type')).toBe(false);
    expect(isReadOnlyAllowed('press')).toBe(false);
    expect(isReadOnlyAllowed('clipboard.write')).toBe(false);
    expect(isReadOnlyAllowed('raise')).toBe(false);
    expect(isReadOnlyAllowed('setValue')).toBe(false);
  });
});
