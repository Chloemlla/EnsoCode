import { describe, expect, it } from 'vitest';
import { createHidProbe, hidSecondsSinceLastEvent, secondsSinceTick } from './occupancyHid';

describe('createHidProbe', () => {
  it('原生加载失败返回 null（不可检测），不当作空闲', () => {
    let loads = 0;
    const probe = createHidProbe(() => {
      loads += 1;
      throw new Error('koffi missing');
    });
    expect(probe()).toBeNull();
    expect(probe()).toBeNull();
    expect(loads).toBe(1);
  });

  it('平台不支持或返回非数值时为 null，正常时返回秒数', () => {
    expect(createHidProbe(() => null)()).toBeNull();
    expect(createHidProbe(() => () => Number.NaN)()).toBeNull();
    expect(createHidProbe(() => () => 1.5)()).toBe(1.5);
  });

  it('调用抛错后视为不可用', () => {
    const probe = createHidProbe(() => () => {
      throw new Error('boom');
    });
    expect(probe()).toBeNull();
  });

  it.runIf(process.platform === 'darwin')('macOS 上真实加载 CoreGraphics', () => {
    expect(hidSecondsSinceLastEvent()).toEqual(expect.any(Number));
  });
});

describe('secondsSinceTick', () => {
  it('按 32 位毫秒计时算间隔，跨越回绕也正确', () => {
    expect(secondsSinceTick(5000, 3000)).toBe(2);
    expect(secondsSinceTick(5, 0xfffffff0)).toBeCloseTo(0.021);
  });
});
