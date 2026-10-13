import { describe, expect, it } from 'vitest';
import { parseTitleBarAppearance } from './windowControls';

describe('parseTitleBarAppearance', () => {
  it('accepts opaque RGB colors without forwarding other window options', () => {
    expect(
      parseTitleBarAppearance({ color: '#102030', symbolColor: '#AABBCC', height: 999 })
    ).toEqual({ color: '#102030', symbolColor: '#AABBCC' });
  });

  it.each([
    null,
    [],
    'dark',
    {},
    { color: '#ffffff' },
    { color: '#fff', symbolColor: '#000000' },
    { color: '#ffffff00', symbolColor: '#000000' },
    { color: 'url(file:///private)', symbolColor: '#000000' },
    { color: '#ffffff', symbolColor: 123 },
  ])('rejects malformed or transparent appearance: %j', (input) => {
    expect(parseTitleBarAppearance(input)).toBeNull();
  });
});
