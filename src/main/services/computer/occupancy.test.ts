import { describe, expect, it } from 'vitest';
import { ComputerOccupancy } from './occupancy';

describe('ComputerOccupancy', () => {
  it('start 显示，stop 隐藏；过期 generation 不再隐藏', () => {
    const events: string[] = [];
    const occupancy = new ComputerOccupancy({
      show: () => events.push('show'),
      hide: () => events.push('hide'),
      registerEsc: () => () => {},
    });
    const first = occupancy.start(() => events.push('abort'));
    const second = occupancy.start(() => events.push('abort2'));
    occupancy.stop(first);
    expect(events).toEqual(['show']);
    occupancy.stop(second);
    expect(events).toEqual(['show', 'hide']);
  });

  it('Esc 中止当前占用并隐藏', () => {
    const events: string[] = [];
    let esc = () => {};
    const occupancy = new ComputerOccupancy({
      show: () => events.push('show'),
      hide: () => events.push('hide'),
      registerEsc: (handler) => {
        esc = handler;
        return () => events.push('unesc');
      },
    });
    occupancy.start(() => events.push('abort'));
    esc();
    expect(events).toEqual(['show', 'abort', 'unesc', 'hide']);
  });

  it('合成 Escape 不中止占用', () => {
    const events: string[] = [];
    let esc = () => {};
    const occupancy = new ComputerOccupancy({
      show: () => events.push('show'),
      hide: () => events.push('hide'),
      registerEsc: (handler) => {
        esc = handler;
        return () => events.push('unesc');
      },
    });
    occupancy.start(() => events.push('abort'));
    occupancy.beginSynthetic();
    esc();
    expect(events).toEqual(['show']);
    occupancy.endSynthetic();
  });

  it('人手 HID 让路；合成输入宽限期内不让路', () => {
    const events: string[] = [];
    let hid = Number.POSITIVE_INFINITY;
    let now = 1_000;
    const occupancy = new ComputerOccupancy({
      show: () => {},
      hide: () => events.push('hide'),
      registerEsc: () => () => {},
      hidSeconds: () => hid,
      now: () => now,
      pollMs: 0,
      syntheticGraceMs: 150,
    });
    occupancy.start(() => events.push('abort'));
    occupancy.beginSynthetic();
    hid = 0;
    occupancy.tick();
    expect(events).toEqual([]);
    occupancy.endSynthetic();
    now = 1_100;
    occupancy.tick();
    expect(events).toEqual([]);
    now = 1_200;
    occupancy.tick();
    expect(events).toEqual(['abort', 'hide']);
  });
});
