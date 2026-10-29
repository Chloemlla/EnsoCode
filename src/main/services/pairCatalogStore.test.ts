import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dir = vi.hoisted(() => ({ value: '' }));
vi.mock('@platform', () => ({ app: { getPath: () => dir.value } }));

import {
  flushPairCatalogSnapshot,
  loadPairCatalogSnapshot,
  parsePairCatalogPayload,
  savePairCatalogSnapshot,
} from './pairCatalogStore';

beforeEach(() => {
  dir.value = mkdtempSync(path.join(tmpdir(), 'pair-catalog-'));
});

describe('pair catalog snapshot', () => {
  it('round-trips the last catalog through disk', () => {
    const snapshot = parsePairCatalogPayload({
      catalog: [{ id: 's1', title: 'Hello' }],
      projects: [{ id: 'p1', name: 'demo' }],
      projectPaths: [{ id: 'p1', path: '/workspace/demo' }],
      theme: 'dark',
    });
    expect(snapshot).not.toBeNull();
    savePairCatalogSnapshot(snapshot!);
    flushPairCatalogSnapshot();
    expect(loadPairCatalogSnapshot()).toEqual(snapshot);
  });

  it('narrows dirty or missing files instead of throwing', () => {
    expect(loadPairCatalogSnapshot()).toBeNull();
    writeFileSync(path.join(dir.value, 'pair-catalog.json'), '{not json');
    expect(loadPairCatalogSnapshot()).toBeNull();
    writeFileSync(
      path.join(dir.value, 'pair-catalog.json'),
      JSON.stringify({ catalog: 'x', theme: 1 })
    );
    expect(loadPairCatalogSnapshot()).toMatchObject({ catalog: [], projects: [], theme: 'system' });
  });

  it('debounces writes to the latest snapshot', () => {
    const base = parsePairCatalogPayload({})!;
    savePairCatalogSnapshot({ ...base, pinnedOrder: ['a'] });
    savePairCatalogSnapshot({ ...base, pinnedOrder: ['b'] });
    flushPairCatalogSnapshot();
    const written = JSON.parse(readFileSync(path.join(dir.value, 'pair-catalog.json'), 'utf8'));
    expect(written.pinnedOrder).toEqual(['b']);
  });
});
