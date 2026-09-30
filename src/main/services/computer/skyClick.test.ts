import { describe, expect, it } from 'vitest';
import {
  skyClickEventRecipe,
  skyClickLocalPoint,
  skyClickWindowMatchesTarget,
  skyLightActivationRecord,
} from './skyClick';

describe('skyClickEventRecipe', () => {
  it('单击：先 target move，再 (-1,-1) primer，再真正 down/up', () => {
    expect(skyClickEventRecipe(1)).toEqual([
      { kind: 'moved', pointKind: 'target', clickState: 0, phase: 2, delayAfterMs: 15 },
      { kind: 'down', pointKind: 'primer', clickState: 1, phase: 1, delayAfterMs: 1 },
      { kind: 'up', pointKind: 'primer', clickState: 1, phase: 2, delayAfterMs: 100 },
      { kind: 'down', pointKind: 'target', clickState: 1, phase: 3, delayAfterMs: 1 },
      { kind: 'up', pointKind: 'target', clickState: 1, phase: 3, delayAfterMs: 0 },
    ]);
  });

  it('只接受 1 或 2 击', () => {
    expect(() => skyClickEventRecipe(3)).toThrow(/click_count/);
    expect(
      skyClickEventRecipe(2).filter((step) => step.pointKind === 'target' && step.kind !== 'moved')
    ).toHaveLength(4);
  });
});

describe('skyLightActivationRecord', () => {
  it('0xF8 字节，写入 windowID 和 focused 标记', () => {
    const focused = skyLightActivationRecord(0x12345678, true);
    expect(focused).toHaveLength(0xf8);
    expect(focused[0x04]).toBe(0xf8);
    expect(focused[0x08]).toBe(0x0d);
    expect(focused[0x3c]).toBe(0x78);
    expect(focused[0x3d]).toBe(0x56);
    expect(focused[0x3e]).toBe(0x34);
    expect(focused[0x3f]).toBe(0x12);
    expect(focused[0x8a]).toBe(0x01);
    expect(skyLightActivationRecord(1, false)[0x8a]).toBe(0x02);
  });
});

describe('skyClickLocalPoint', () => {
  it('屏幕坐标换成窗口内坐标', () => {
    expect(skyClickLocalPoint({ x: 120, y: 80 }, { x: 100, y: 50, width: 40, height: 40 })).toEqual(
      {
        x: 20,
        y: 30,
      }
    );
  });
});

describe('skyClickWindowMatchesTarget', () => {
  it('要求同 pid、同 windowID 且在屏上', () => {
    const windows = [{ id: '9', pid: 42, onScreen: true }];
    expect(skyClickWindowMatchesTarget(windows, 9, 42)).toBe(true);
    expect(skyClickWindowMatchesTarget(windows, 9, 41)).toBe(false);
    expect(skyClickWindowMatchesTarget([{ id: '9', pid: 42, onScreen: false }], 9, 42)).toBe(false);
  });
});
