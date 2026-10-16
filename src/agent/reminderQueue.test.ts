import { describe, expect, it } from 'vitest';
import { enqueueReminder } from './reminderQueue';

describe('enqueueReminder', () => {
  it('未满时追加，不驱逐', () => {
    const queue = ['a'];
    expect(enqueueReminder(queue, 'b', 3)).toBe(false);
    expect(queue).toEqual(['a', 'b']);
  });

  it('满了丢最旧并报告驱逐，新通知总能入队', () => {
    const queue = ['a', 'b', 'c'];
    expect(enqueueReminder(queue, 'd', 3)).toBe(true);
    expect(queue).toEqual(['b', 'c', 'd']);
  });
});
