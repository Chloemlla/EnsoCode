import { describe, expect, it } from 'vitest';
import { applyJsonDelta, diffJson, type JsonOp } from './jsonDelta';

const roundtrip = (a: unknown, b: unknown): JsonOp[] => {
  const ops = diffJson(a, b);
  const frozen = JSON.parse(JSON.stringify(a));
  expect(applyJsonDelta(frozen, ops)).toEqual(b);
  expect(frozen).toEqual(a);
  return ops;
};

describe('jsonDelta', () => {
  it('相同值无操作', () => {
    expect(diffJson({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toEqual([]);
  });

  it('对象字段增删改只带变化的叶子', () => {
    const a = {
      conversations: { c1: { title: 't', activeMs: 1, big: 'x'.repeat(1000) } },
      order: ['c1'],
    };
    const b = {
      conversations: { c1: { title: 't', activeMs: 2, big: 'x'.repeat(1000), unread: true } },
      order: ['c1'],
    };
    const ops = roundtrip(a, b);
    expect(JSON.stringify(ops).length).toBeLessThan(100);
    roundtrip(b, a);
  });

  it('长字符串追加只发后缀', () => {
    const head = 'hello world '.repeat(20);
    const ops = roundtrip({ text: head }, { text: `${head}more` });
    expect(ops).toEqual([['a', ['text'], 'more']]);
  });

  it('数组增长、截断与元素内变化', () => {
    roundtrip({ c: [{ t: 'a' }] }, { c: [{ t: 'ab' }, { t: 'x' }] });
    roundtrip({ c: [1, 2, 3] }, { c: [1] });
    roundtrip([1, 2], [3]);
  });

  it('类型变化与根替换', () => {
    roundtrip({ a: [1] }, { a: { 0: 1 } });
    roundtrip({ a: 1 }, 'x');
    roundtrip(null, { a: 1 });
  });

  it('带 $enso 标签的编码值整体替换，不深入', () => {
    const ops = diffJson(
      { v: { $enso: 'map', v: [[1, 2]] } },
      { v: { $enso: 'map', v: [[1, 3]] } }
    );
    expect(ops).toEqual([['s', ['v'], { $enso: 'map', v: [[1, 3]] }]]);
  });

  it('非法路径抛错', () => {
    expect(() => applyJsonDelta({ a: 1 }, [['s', ['a', 'b'], 1]])).toThrow();
    expect(() => applyJsonDelta({}, [['s', ['__proto__', 'x'], 1]])).toThrow();
  });
});
