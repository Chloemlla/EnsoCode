import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb } from './db';
import { createMemory, getMemory, listMemories, updateMemory } from './store';
import { type Embedder, MemoryValidationError, projectSpaceId } from './types';

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-memory-store-'));
  db = openMemoryDb(path.join(dir, 'memory.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2025-01-31T12:00:00Z');

function fakeEmbedder(vec: number[] = [3, 4]): Embedder {
  return { model: 'fake', dim: vec.length, embed: async () => Float32Array.from(vec) };
}

describe('createMemory — title 与 temporal_context 边界', () => {
  it('显式 title 也截到 80 字（max 80），与 deriveTitle 一致', async () => {
    const long = '标'.repeat(120);
    const r = await createMemory(db, { content: 'c', title: long, spaceId: 'global' });
    if (r.status !== 'inserted') throw new Error();
    expect(Array.from(r.memory.title)).toHaveLength(80);
    expect(r.memory.title).toBe('标'.repeat(80));
  });

  it('有事件日期时 temporal_context 不再默认 timeless，按事件区间相对 now 派生', async () => {
    const at = async (eventStart: string, eventEnd?: string) => {
      const r = await createMemory(
        db,
        // 正文带上日期：同 space 同文本会被 content_hash 去重成第一行
        { content: `c ${eventStart} ${eventEnd ?? ''}`, spaceId: 'global', eventStart, eventEnd },
        { now: NOW }
      );
      if (r.status !== 'inserted') throw new Error();
      return r.memory.temporalContext;
    };
    expect(await at('2020')).toBe('past');
    expect(await at('2024-12')).toBe('past');
    expect(await at('2025-01')).toBe('present');
    expect(await at('2025-01-31')).toBe('present');
    expect(await at('2024', '2026')).toBe('present');
    expect(await at('2025-02-01')).toBe('future');
    expect(await at('2030')).toBe('future');
  });

  it('显式 temporal_context 优先；无事件日期仍为 timeless', async () => {
    const r = await createMemory(
      db,
      { content: 'c', spaceId: 'global', eventStart: '2020', temporalContext: 'timeless' },
      { now: NOW }
    );
    if (r.status !== 'inserted') throw new Error();
    expect(r.memory.temporalContext).toBe('timeless');
    const plain = await createMemory(db, { content: 'c', spaceId: 'global' }, { now: NOW });
    if (plain.status !== 'inserted') throw new Error();
    expect(plain.memory.temporalContext).toBe('timeless');
  });
});

describe('createMemory', () => {
  it('inserts with defaults and returns status inserted', async () => {
    const r = await createMemory(
      db,
      { content: '我们决定用 Postgres 做主库', spaceId: 'global' },
      { now: NOW }
    );
    expect(r.status).toBe('inserted');
    if (r.status !== 'inserted') return;
    const m = r.memory;
    expect(m.unitType).toBe('fact');
    expect(m.unitTypeSource).toBe('default');
    expect(m.importance).toBe(0.5);
    expect(m.confidence).toBe(0.6);
    expect(m.isLatest).toBe(true);
    expect(m.version).toBe(1);
    expect(m.lifecycleState).toBe('active');
    expect(m.temporalContext).toBe('timeless');
    expect(m.createdAt).toBe('2025-01-31T12:00:00.000Z');
    expect(m.updatedAt).toBe(m.createdAt);
    // last_accessed_at 缺省等于 created_at
    expect(m.lastAccessedAt).toBe(m.createdAt);
    expect(m.title).toBeTruthy();
    expect(getMemory(db, m.id)).toEqual(m);
  });

  it('marks explicit unit_type as explicit', async () => {
    const r = await createMemory(db, { content: 'x', spaceId: 'global', unitType: 'decision' });
    if (r.status !== 'inserted') throw new Error();
    expect(r.memory.unitType).toBe('decision');
    expect(r.memory.unitTypeSource).toBe('explicit');
  });

  it('normalizes event dates and precision', async () => {
    const r = await createMemory(db, {
      content: 'x',
      spaceId: 'global',
      eventStart: '2020',
      eventEnd: '2021-03',
    });
    if (r.status !== 'inserted') throw new Error();
    expect(r.memory.eventStart).toBe('2020-01-01');
    expect(r.memory.eventEnd).toBe('2021-03-01');
    expect(r.memory.temporalPrecision).toBe('year');
  });

  it('rejects event_end earlier than event_start with a validation error', async () => {
    await expect(
      createMemory(db, { content: 'x', spaceId: 'global', eventStart: '2021', eventEnd: '2020' })
    ).rejects.toBeInstanceOf(MemoryValidationError);
  });

  it('rejects invalid event dates, spaces and empty content', async () => {
    await expect(
      createMemory(db, { content: 'x', spaceId: 'global', eventStart: 'yesterday' })
    ).rejects.toMatchObject({ code: 'invalid_event_date' });
    await expect(createMemory(db, { content: 'x', spaceId: 'work' })).rejects.toMatchObject({
      code: 'invalid_space',
    });
    await expect(createMemory(db, { content: '   ', spaceId: 'global' })).rejects.toMatchObject({
      code: 'empty_content',
    });
  });

  it('stores an L2-normalized float32 LE embedding with model metadata', async () => {
    const r = await createMemory(
      db,
      { content: 'x', spaceId: 'global' },
      { embedder: fakeEmbedder([3, 4]) }
    );
    if (r.status !== 'inserted') throw new Error();
    expect(r.memory.embeddingModel).toBe('fake');
    expect(r.memory.embeddingDim).toBe(2);
    const row = db.prepare('SELECT embedding FROM memories WHERE id = ?').get(r.memory.id) as {
      embedding: Buffer;
    };
    const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, 2);
    expect(vec[0]).toBeCloseTo(0.6, 6);
    expect(vec[1]).toBeCloseTo(0.8, 6);
  });

  it('still inserts when the embedder throws', async () => {
    const broken: Embedder = {
      model: 'broken',
      dim: 2,
      embed: async () => {
        throw new Error('boom');
      },
    };
    const r = await createMemory(db, { content: 'x', spaceId: 'global' }, { embedder: broken });
    expect(r.status).toBe('inserted');
    if (r.status !== 'inserted') return;
    expect(r.memory.embeddingModel).toBeNull();
    expect(getMemory(db, r.memory.id)).not.toBeNull();
  });

  it("rejects '' as idempotency_key instead of letting the second insert hit UNIQUE", async () => {
    await expect(
      createMemory(db, { content: 'x', spaceId: 'global', idempotencyKey: '' })
    ).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
    await expect(
      createMemory(db, { content: 'x', spaceId: 'global', idempotencyKey: '  ' })
    ).rejects.toBeInstanceOf(MemoryValidationError);
  });

  it('same key from two connections concurrently → one row, both callers get it', async () => {
    const other = openMemoryDb(path.join(dir, 'memory.db'));
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          createMemory(i % 2 ? db : other, {
            content: `race ${i}`,
            spaceId: 'global',
            idempotencyKey: 'race-key',
          })
        )
      );
      const ids = new Set(results.map((r) => (r.status === 'inserted' ? r.memory.id : '')));
      expect(ids.size).toBe(1);
      expect(listMemories(db, { spaceIds: ['global'] })).toHaveLength(1);
    } finally {
      other.close();
    }
  });

  it('is idempotent on idempotency_key', async () => {
    const a = await createMemory(db, { content: 'x', spaceId: 'global', idempotencyKey: 'k1' });
    const b = await createMemory(db, { content: 'y', spaceId: 'global', idempotencyKey: 'k1' });
    if (a.status !== 'inserted' || b.status !== 'inserted') throw new Error();
    expect(b.memory.id).toBe(a.memory.id);
    expect(b.memory.content).toBe('x');
    expect(listMemories(db, { spaceIds: ['global'] })).toHaveLength(1);
  });
});

describe('listMemories / updateMemory', () => {
  it('lists only latest active rows of the requested spaces', async () => {
    const proj = projectSpaceId('p1');
    await createMemory(db, { content: 'g', spaceId: 'global' });
    await createMemory(db, { content: 'p', spaceId: proj });
    const other = await createMemory(db, { content: 'o', spaceId: projectSpaceId('p2') });
    if (other.status !== 'inserted') throw new Error();
    updateMemory(db, other.memory.id, { isLatest: false });
    expect(
      listMemories(db, { spaceIds: ['global', proj] })
        .map((m) => m.content)
        .sort()
    ).toEqual(['g', 'p']);
    expect(listMemories(db, { spaceIds: [projectSpaceId('p2')] })).toEqual([]);
    expect(
      listMemories(db, { spaceIds: [projectSpaceId('p2')], includeNonLatest: true })
    ).toHaveLength(1);
  });

  it('updates content, bumps updated_at and re-syncs FTS', async () => {
    const r = await createMemory(db, { content: 'old text here', spaceId: 'global' }, { now: NOW });
    if (r.status !== 'inserted') throw new Error();
    const later = new Date('2025-02-01T00:00:00Z');
    const u = updateMemory(
      db,
      r.memory.id,
      { content: 'brand new text', importance: 0.9 },
      { now: later }
    );
    expect(u?.content).toBe('brand new text');
    expect(u?.importance).toBe(0.9);
    expect(u?.updatedAt).toBe('2025-02-01T00:00:00.000Z');
    expect(u?.createdAt).toBe('2025-01-31T12:00:00.000Z');
    const hit = db
      .prepare('SELECT count(*) AS n FROM memories_fts WHERE memories_fts MATCH \'"brand"\'')
      .get() as { n: number };
    expect(hit.n).toBe(1);
    expect(updateMemory(db, 'missing', { title: 'x' })).toBeNull();
  });

  it('clamps an edited title to the same limit as new memories', async () => {
    const r = await createMemory(db, { content: 'body', spaceId: 'global' }, { now: NOW });
    if (r.status !== 'inserted') throw new Error();
    const u = updateMemory(db, r.memory.id, { title: `  ${'标'.repeat(100)}  ` });
    expect(Array.from(u?.title ?? '')).toHaveLength(80);
  });
});
