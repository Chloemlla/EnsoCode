import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerOccupancy } from './occupancy';

function escHarness(extra: { syntheticGraceMs?: number; now?: () => number } = {}) {
  const events: string[] = [];
  let esc: (() => void) | undefined;
  const occupancy = new ComputerOccupancy({
    show: () => events.push('show'),
    hide: () => events.push('hide'),
    registerEsc: (handler) => {
      esc = handler;
      events.push('esc+');
      return () => {
        esc = undefined;
        events.push('esc-');
      };
    },
    ...extra,
  });
  return { events, occupancy, press: () => esc?.() };
}

describe('ComputerOccupancy', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('合成 Escape 期间注销热键，宽限后恢复，不中止占用', () => {
    vi.useFakeTimers();
    const { events, occupancy, press } = escHarness({ syntheticGraceMs: 150 });
    occupancy.start(() => events.push('abort'));
    occupancy.beginSynthetic({ keys: ['Escape'] });
    expect(events).toEqual(['show', 'esc+', 'esc-']);
    press();
    occupancy.endSynthetic();
    expect(events).toEqual(['show', 'esc+', 'esc-']);
    vi.advanceTimersByTime(150);
    expect(events).toEqual(['show', 'esc+', 'esc-', 'esc+']);
    press();
    expect(events).toEqual(['show', 'esc+', 'esc-', 'esc+', 'abort', 'esc-', 'hide']);
  });

  it('非 Escape 合成期间用户按 Esc：记为 pending，结束合成时中止', () => {
    const { events, occupancy, press } = escHarness();
    occupancy.start(() => events.push('abort'));
    occupancy.beginSynthetic({ keys: ['cmd', 'a'] });
    press();
    expect(events).toEqual(['show', 'esc+']);
    occupancy.endSynthetic();
    expect(events).toEqual(['show', 'esc+', 'abort', 'esc-', 'hide']);
  });

  it('无参 beginSynthetic 仍可用；期间的 Esc 视为用户按键', () => {
    const { events, occupancy, press } = escHarness();
    occupancy.start(() => events.push('abort'));
    occupancy.beginSynthetic();
    press();
    expect(events).toEqual(['show', 'esc+']);
    occupancy.endSynthetic();
    expect(events).toEqual(['show', 'esc+', 'abort', 'esc-', 'hide']);
  });

  it('非 Escape 合成后的宽限期内 Esc 立即中止', () => {
    let now = 1_000;
    const { events, occupancy, press } = escHarness({ now: () => now, syntheticGraceMs: 150 });
    occupancy.start(() => events.push('abort'));
    occupancy.beginSynthetic({ keys: ['a'] });
    occupancy.endSynthetic();
    now = 1_050;
    press();
    expect(events).toEqual(['show', 'esc+', 'abort', 'esc-', 'hide']);
  });

  it('stop 清掉 pending Esc 与待恢复热键', () => {
    vi.useFakeTimers();
    const { events, occupancy, press } = escHarness();
    const gen = occupancy.start(() => events.push('abort'));
    occupancy.beginSynthetic({ keys: ['a'] });
    press();
    occupancy.stop(gen);
    occupancy.endSynthetic();
    const gen2 = occupancy.start(() => events.push('abort2'));
    occupancy.beginSynthetic({ keys: ['esc'] });
    occupancy.endSynthetic();
    occupancy.stop(gen2);
    vi.runAllTimers();
    expect(events).toEqual(['show', 'esc+', 'esc-', 'hide', 'show', 'esc+', 'esc-', 'hide']);
  });

  it('HID 不可用时不当作空闲：canDetectUserInput 为 false，Esc 仍可取消', () => {
    const { events, occupancy, press } = escHarness();
    expect(occupancy.canDetectUserInput()).toBe(false);
    const hidless = new ComputerOccupancy({
      show: () => {},
      hide: () => {},
      registerEsc: () => () => {},
      hidSeconds: () => null,
      pollMs: 0,
    });
    expect(hidless.canDetectUserInput()).toBe(false);
    const hid = new ComputerOccupancy({
      show: () => {},
      hide: () => {},
      registerEsc: () => () => {},
      hidSeconds: () => 5,
      pollMs: 0,
    });
    expect(hid.canDetectUserInput()).toBe(true);
    occupancy.start(() => events.push('abort'));
    press();
    expect(events).toEqual(['show', 'esc+', 'abort', 'esc-', 'hide']);
  });

  it('HID 探测返回 null 时 tick 不让路也不抛错', () => {
    const events: string[] = [];
    const occupancy = new ComputerOccupancy({
      show: () => {},
      hide: () => events.push('hide'),
      registerEsc: () => () => {},
      hidSeconds: () => null,
      pollMs: 0,
    });
    occupancy.start(() => events.push('abort'));
    occupancy.tick();
    expect(events).toEqual([]);
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
