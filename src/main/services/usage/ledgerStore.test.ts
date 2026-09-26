import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestSessionJsonl, loadLedger, usageLedgerDir } from './ledgerStore';

describe('usage ledger store', () => {
  let root: string;
  let sessionDir: string;

  const assistant = (id: string, input: number) =>
    JSON.stringify({
      type: 'message',
      id,
      timestamp: '2026-09-03T00:00:00.000Z',
      message: {
        role: 'assistant',
        model: 'm',
        timestamp: Date.parse('2026-09-03T00:00:00.000Z'),
        usage: { input, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
    });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-ledger-'));
    sessionDir = path.join(root, 'sessions');
    fs.mkdirSync(sessionDir);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ingest 把 jsonl 快照写到 sessions 的同级 usage-ledger，不写进 sessions', async () => {
    const file = path.join(sessionDir, 'a.jsonl');
    fs.writeFileSync(
      file,
      `${JSON.stringify({ type: 'session', version: 3, id: 'sid', cwd: '/p/demo' })}\n${JSON.stringify(
        {
          type: 'message',
          id: 'e1',
          timestamp: '2026-09-03T00:00:00.000Z',
          message: {
            role: 'assistant',
            model: 'm',
            timestamp: Date.parse('2026-09-03T00:00:00.000Z'),
            usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 },
          },
        }
      )}\n`
    );
    await ingestSessionJsonl(sessionDir, file);
    expect(fs.existsSync(path.join(sessionDir, 'sid.json'))).toBe(false);
    const loaded = await loadLedger(sessionDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.sessionId).toBe('sid');
    expect(loaded[0]?.records[0]?.id).toBe('e1');
    expect(loaded[0]?.records[0]?.input).toBe(3);
    expect(usageLedgerDir(sessionDir)).toBe(path.join(root, 'usage-ledger'));
  });

  it('jsonl 已删除时 ingest 不抛，已有账本仍能 load', async () => {
    const file = path.join(sessionDir, 'a.jsonl');
    fs.writeFileSync(
      file,
      `${JSON.stringify({ type: 'session', version: 3, id: 'sid', cwd: '/p/demo' })}\n`
    );
    await ingestSessionJsonl(sessionDir, file);
    fs.rmSync(file);
    await expect(ingestSessionJsonl(sessionDir, file)).resolves.toBeUndefined();
    expect(await loadLedger(sessionDir)).toHaveLength(1);
  });

  it('重复 load 时反映账本的覆盖与删除', async () => {
    const file = path.join(sessionDir, 'a.jsonl');
    const head = JSON.stringify({ type: 'session', version: 3, id: 'sid', cwd: '/p/demo' });
    fs.writeFileSync(file, `${head}\n${assistant('e1', 3)}\n`);
    await ingestSessionJsonl(sessionDir, file);
    expect((await loadLedger(sessionDir))[0]?.records).toHaveLength(1);

    fs.writeFileSync(file, `${head}\n${assistant('e1', 3)}\n${assistant('e2', 5)}\n`);
    await ingestSessionJsonl(sessionDir, file);
    expect((await loadLedger(sessionDir))[0]?.records.map((r) => r.id)).toEqual(['e1', 'e2']);

    fs.rmSync(path.join(usageLedgerDir(sessionDir), 'sid.json'));
    expect(await loadLedger(sessionDir)).toEqual([]);
  });
});
