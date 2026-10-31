import { describe, expect, it } from 'vitest';
import { extractTriggerQuery, normalizeCandidates, normalizePick } from './triggers';

describe('# 补全', () => {
  it('只在词首的 # 后取查询', () => {
    expect(extractTriggerQuery('看看 #iss')).toBe('iss');
    expect(extractTriggerQuery('#')).toBe('');
    expect(extractTriggerQuery('a#b')).toBeNull();
    expect(extractTriggerQuery('#a b')).toBeNull();
    expect(extractTriggerQuery('plain')).toBeNull();
  });

  it('候选项清洗：丢掉坏项，截断长文本，最多 50 条', () => {
    const raw = [
      { id: '1', label: 'x'.repeat(100), detail: 'd'.repeat(300) },
      { id: 2, label: 'bad id' },
      { id: '3' },
      'junk',
      ...Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, label: `n${i}` })),
    ];
    const items = normalizeCandidates('a.b', 'demo', raw);
    expect(items).toHaveLength(50);
    expect(items[0]).toEqual({
      key: 'a.b:demo:1',
      pluginId: 'a.b',
      name: 'demo',
      item: { id: '1', label: 'x'.repeat(64), detail: 'd'.repeat(120) },
    });
    expect(items[1]?.item.id).toBe('n0');
    expect(normalizeCandidates('a.b', 'demo', { not: 'array' })).toEqual([]);
  });

  it('选中结果只接受文本', () => {
    expect(normalizePick({ text: 'hi' })).toBe('hi');
    expect(normalizePick('hi')).toBe('hi');
    expect(normalizePick(null)).toBeNull();
    expect(normalizePick({ text: 1 })).toBeNull();
    expect(normalizePick('x'.repeat(40_000))).toBeNull();
  });
});
