import { describe, expect, it } from 'vitest';
import { normalizeScrollDelta } from './scrollDelta';

describe('normalizeScrollDelta', () => {
  it('认 dy / deltaY / amount，以及位置参数 dx,dy', () => {
    expect(normalizeScrollDelta({ dy: 40 })).toEqual({ dx: 0, dy: 40 });
    expect(normalizeScrollDelta({ deltaY: -80, deltaX: 10 })).toEqual({ dx: 10, dy: -80 });
    expect(normalizeScrollDelta({ amount: 30 })).toEqual({ dx: 0, dy: 30 });
    expect(normalizeScrollDelta({ dx: 2, dy: 3 })).toEqual({ dx: 2, dy: 3 });
  });

  it('缺省是 0', () => {
    expect(normalizeScrollDelta({})).toEqual({ dx: 0, dy: 0 });
  });
});
