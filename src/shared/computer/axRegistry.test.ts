import { describe, expect, it } from 'vitest';
import { AxRegistry } from './axRegistry';
import { StaleRefError } from './errors';

describe('AxRegistry', () => {
  it('新 snapshot 作废更早一代，当前与上一世代仍可解析', () => {
    const registry = new AxRegistry<string>();
    const g1 = registry.beginSnapshot('w1');
    const a = registry.register('w1', g1, 'A');
    expect(registry.resolve(a)).toBe('A');

    const g2 = registry.beginSnapshot('w1');
    const b = registry.register('w1', g2, 'B');
    expect(registry.resolve(a)).toBe('A');
    expect(registry.resolve(b)).toBe('B');

    registry.beginSnapshot('w1');
    expect(() => registry.resolve(a)).toThrow(StaleRefError);
    expect(registry.resolve(b)).toBe('B');
  });

  it('坏 ref 和别的窗口互不影响', () => {
    const registry = new AxRegistry<number>();
    const g = registry.beginSnapshot('w1');
    const ref = registry.register('w1', g, 7);
    registry.beginSnapshot('w2');
    expect(registry.resolve(ref)).toBe(7);
    expect(registry.targetOf(ref)).toBe('w1');
    expect(() => registry.resolve('e999')).toThrow(/expired/);
    expect(() => registry.resolve('nope')).toThrow(StaleRefError);
  });
});
