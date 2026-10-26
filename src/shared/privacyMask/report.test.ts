import { describe, expect, it } from 'vitest';
import { type MaskHit, mergeMaskReports, parseMaskReport, strongestAction } from './report';

const hit: MaskHit = {
  kind: 'API_KEY',
  rule: 'openai',
  action: 'mask',
  where: 'user',
  token: 'abcdefgh',
  preview: 'sk-…(51)',
  count: 2,
};

describe('mask report', () => {
  it('rebuilds whitelisted fields and drops bad hits', () => {
    const parsed = parseMaskReport({
      hits: [
        { ...hit, value: 'sk-secret' },
        { ...hit, where: 'nowhere' },
        { ...hit, token: 'A!' },
      ],
      blocked: false,
      restored: 1,
      extra: 'x',
    });
    expect(parsed).toEqual({ hits: [hit], blocked: false, restored: 1 });
  });

  it('rejects malformed reports', () => {
    expect(parseMaskReport({ hits: 'x', blocked: false, restored: 0 })).toBeUndefined();
    expect(parseMaskReport({ hits: [], blocked: 'no', restored: 0 })).toBeUndefined();
    expect(parseMaskReport(null)).toBeUndefined();
  });

  it('merges counts and picks the strongest action', () => {
    const a = parseMaskReport({ hits: [hit], blocked: false, restored: 1 });
    const b = {
      hits: [
        { ...hit, count: 1 },
        { ...hit, action: 'warn' as const, count: 1 },
      ],
      blocked: true,
      restored: 2,
    };
    const merged = mergeMaskReports(a, b);
    expect(merged).toMatchObject({ blocked: true, restored: 3 });
    expect(merged.hits.map((h) => [h.action, h.count])).toEqual([
      ['mask', 3],
      ['warn', 1],
    ]);
    expect(strongestAction(merged)).toBe('warn');
  });
});
