import { describe, expect, it } from 'vitest';
import { useSettingsStore } from './settings-store';

describe('settings-store stub', () => {
  it('provides fields that reused desktop components dereference', () => {
    const state = useSettingsStore.getState();
    expect(state.privacyMasking.enabled).toBe(false);
    expect(state.contextMenuOpen).toEqual([]);
  });
});
