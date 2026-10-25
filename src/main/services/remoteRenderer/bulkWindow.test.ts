import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkWindow } from './bulkWindow';

describe('BulkWindow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes everything through until the browser starts acking (old shells)', () => {
    const sent: string[] = [];
    const win = new BulkWindow<string>((item) => sent.push(item), { windowBytes: 10 });
    win.push('a', 8);
    win.push('b', 8);
    win.push('c', 8);
    expect(sent).toEqual(['a', 'b', 'c']);
  });

  it('keeps at most a window of unacked bytes in flight once acks arrive', () => {
    const sent: string[] = [];
    const win = new BulkWindow<string>((item) => sent.push(item), { windowBytes: 10 });
    win.ack(0);
    win.push('a', 6);
    win.push('b', 6);
    win.push('c', 6);
    expect(sent).toEqual(['a', 'b']);
    win.ack(1);
    expect(sent).toEqual(['a', 'b']);
    win.ack(6);
    expect(sent).toEqual(['a', 'b', 'c']);
  });

  it('treats a smaller cumulative count as a new page', () => {
    const sent: string[] = [];
    const win = new BulkWindow<string>((item) => sent.push(item), { windowBytes: 10 });
    win.ack(1000);
    win.push('a', 6);
    win.push('b', 6);
    win.push('c', 6);
    win.ack(12);
    expect(sent).toEqual(['a', 'b', 'c']);
  });

  it('drops queued frames when the link goes down (host replays on resume)', () => {
    const sent: string[] = [];
    const win = new BulkWindow<string>((item) => sent.push(item), { windowBytes: 10 });
    win.ack(0);
    win.push('a', 10);
    win.push('b', 10);
    win.reset();
    win.push('c', 10);
    expect(sent).toEqual(['a', 'c']);
  });

  it('does not stall forever when acks are lost', () => {
    const sent: string[] = [];
    const win = new BulkWindow<string>((item) => sent.push(item), {
      windowBytes: 10,
      stallMs: 1000,
    });
    win.ack(0);
    win.push('a', 10);
    win.push('b', 10);
    expect(sent).toEqual(['a']);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(['a', 'b']);
  });
});
