import { describe, expect, it } from 'vitest';
import { deskBase, downloadProgress, loadDeskMeta, saveDeskMeta } from './launch';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('desk launch meta', () => {
  it('remembers the last renderer build per desktop', () => {
    const storage = new MemoryStorage();
    saveDeskMeta(storage, 'pair-a', { version: '0.2.9-abc', platform: 'darwin' });
    expect(loadDeskMeta(storage, 'pair-a')).toEqual({ version: '0.2.9-abc', platform: 'darwin' });
    expect(loadDeskMeta(storage, 'pair-b')).toBeNull();
  });

  it('ignores corrupt or unsafe entries', () => {
    const storage = new MemoryStorage();
    storage.setItem('enso-desk-meta:p', '{');
    expect(loadDeskMeta(storage, 'p')).toBeNull();
    storage.setItem('enso-desk-meta:p', JSON.stringify({ version: '../x', platform: 'darwin' }));
    expect(loadDeskMeta(storage, 'p')).toBeNull();
    storage.setItem('enso-desk-meta:p', JSON.stringify({ version: '1', platform: 7 }));
    expect(loadDeskMeta(storage, 'p')).toBeNull();
  });

  it('builds the service-worker path for a build', () => {
    expect(deskBase('a/b', '0.2.9-x')).toBe('/desk/r/a%2Fb/0.2.9-x');
  });
});

describe('downloadProgress', () => {
  it('shows downloaded / total, never reaching the total before load finishes', () => {
    const MB = 1024 * 1024;
    expect(downloadProgress(1.2 * MB, 4.8 * MB)).toBe('1.2 / 4.8 MB');
    expect(downloadProgress(6 * MB, 4.8 * MB)).toBe('4.8 / 4.8 MB');
    expect(downloadProgress(5 * MB, 10 * MB)).toBe('5.0 / 10.0 MB');
  });

  it('falls back to downloaded only when an old desktop reports no total', () => {
    expect(downloadProgress(2.2 * 1024 * 1024)).toBe('2.2 MB');
  });
});
