import { describe, expect, it } from 'vitest';
import {
  DRAWER_SEGMENT_KEY,
  loadDrawerSegment,
  resolveDrawerSegment,
  saveDrawerSegment,
} from './drawerSegment';

function memoryStorage(): void {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
}

describe('drawerSegment', () => {
  it('starts with no saved segment and persists a valid one', () => {
    memoryStorage();
    expect(loadDrawerSegment()).toBeNull();
    saveDrawerSegment('bot');
    expect(loadDrawerSegment()).toBe('bot');
    saveDrawerSegment('code');
    expect(loadDrawerSegment()).toBe('code');
  });

  it('treats a dirty stored value as unset', () => {
    memoryStorage();
    localStorage.setItem(DRAWER_SEGMENT_KEY, 'garbage');
    expect(loadDrawerSegment()).toBeNull();
    expect(resolveDrawerSegment(true, 'chat-1')).toBe(true);
  });

  it('restores the remembered tab on drawer reopen', () => {
    memoryStorage();
    saveDrawerSegment('bot');
    expect(resolveDrawerSegment(true, null)).toBe(true);
    expect(resolveDrawerSegment(true, 'chat-1')).toBe(true);

    saveDrawerSegment('code');
    expect(resolveDrawerSegment(true, null)).toBe(false);
    expect(resolveDrawerSegment(true, 'chat-1')).toBe(false);
  });

  it('keeps the open Bot chat on the Bot tab until the user picks 项目', () => {
    memoryStorage();
    expect(resolveDrawerSegment(true, 'chat-1')).toBe(true);
    expect(resolveDrawerSegment(true, null)).toBe(false);
  });

  it('falls back to 项目 when Bot is unavailable', () => {
    memoryStorage();
    saveDrawerSegment('bot');
    expect(resolveDrawerSegment(false, 'chat-1')).toBe(false);
    expect(resolveDrawerSegment(false, null)).toBe(false);
  });
});
