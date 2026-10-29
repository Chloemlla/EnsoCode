import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHostDir, listHostDirs } from './hostDirs';

describe('listHostDirs', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'host-dirs-'));
    mkdirSync(path.join(home, 'beta'));
    mkdirSync(path.join(home, 'Alpha'));
    mkdirSync(path.join(home, '.hidden'));
    writeFileSync(path.join(home, 'file.txt'), '');
    symlinkSync(path.join(home, 'beta'), path.join(home, 'linked'));
    symlinkSync(path.join(home, 'missing'), path.join(home, 'dangling'));
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('defaults to home and lists visible subdirectories including symlinked ones', async () => {
    const result = await listHostDirs(undefined, home);
    expect(result).toEqual({
      ok: true,
      path: home,
      parent: path.dirname(home),
      dirs: ['Alpha', 'beta', 'linked'],
    });
  });

  it('expands ~ and resolves relative input against home', async () => {
    expect(await listHostDirs('~/beta', home)).toMatchObject({ path: path.join(home, 'beta') });
    expect(await listHostDirs('Alpha', home)).toMatchObject({ path: path.join(home, 'Alpha') });
  });

  it('falls back to the nearest existing ancestor for a half-typed path', async () => {
    const result = await listHostDirs(path.join(home, 'beta', 'not', 'yet'), home);
    expect(result).toMatchObject({ ok: true, path: path.join(home, 'beta') });
    expect(await listHostDirs(path.join(home, 'file.txt'), home)).toMatchObject({ path: home });
  });

  it('reports root as having no parent', async () => {
    expect(await listHostDirs(path.parse(home).root, home)).toMatchObject({ parent: null });
  });

  it('creates a folder and lists it', async () => {
    const result = await createHostDir(home, ' gamma ');
    expect(result).toEqual({ ok: true, path: path.join(home, 'gamma'), parent: home, dirs: [] });
    expect((await listHostDirs(home, home)).ok && (await listHostDirs(home, home))).toMatchObject({
      dirs: ['Alpha', 'beta', 'gamma', 'linked'],
    });
  });

  it('rejects existing names, bad names and relative parents', async () => {
    const exists = 'A file or folder with that name already exists.';
    expect(await createHostDir(home, 'beta')).toEqual({ ok: false, error: exists });
    expect(await createHostDir(home, 'file.txt')).toEqual({ ok: false, error: exists });
    for (const name of ['', '  ', '.', '..', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(256)]) {
      expect(await createHostDir(home, name)).toEqual({ ok: false, error: 'Invalid folder name.' });
    }
    expect(await createHostDir('relative', 'x')).toEqual({ ok: false, error: 'Invalid request.' });
    expect(await createHostDir(path.join(home, 'missing'), 'x')).toMatchObject({ ok: false });
  });
});
