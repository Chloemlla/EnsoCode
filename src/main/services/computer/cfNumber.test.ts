import { describe, expect, it } from 'vitest';
import { decodeCfNumberAsFloat64, kCFNumberFloat64Type } from './cfNumber';

describe('CFNumber window fields', () => {
  it('does not use SInt64 (4) bytes as a double — that denormal rounds to window id 0', () => {
    const asInt64 = Buffer.alloc(8);
    asInt64.writeBigInt64LE(12345n);
    expect(Math.round(asInt64.readDoubleLE(0))).toBe(0);
    expect(kCFNumberFloat64Type).toBe(6);
  });

  it('float64 payload keeps window numbers and bounds', () => {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(1420);
    expect(decodeCfNumberAsFloat64(buf)).toBe(1420);
    buf.writeDoubleLE(1470.5);
    expect(decodeCfNumberAsFloat64(buf)).toBe(1470.5);
  });
});
