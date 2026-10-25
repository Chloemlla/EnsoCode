import { describe, expect, it } from 'vitest';
import { stallDelay } from './stall';

describe('stallDelay', () => {
  it('waits the full window after the latest activity', () => {
    expect(stallDelay(10_000, 8_000, 9_000, 5_000)).toBe(7_000);
  });

  it('keeps waiting while data is still arriving', () => {
    // 缺口出现很久了，但 1 秒前还在收分片：不算丢帧
    expect(stallDelay(30_000, 8_000, 29_000, 1_000)).toBe(7_000);
  });

  it('reports a stall once nothing arrived for the window', () => {
    expect(stallDelay(30_000, 8_000, 20_000, 1_000)).toBe(0);
  });
});
