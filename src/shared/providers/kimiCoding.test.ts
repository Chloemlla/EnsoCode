import { describe, expect, it } from 'vitest';
import { kimiCodingBearerToken, parseKimiCodingUsageWindows } from './kimiCoding';

const reset5h = '2026-09-01T00:00:00.000Z';
const reset7d = '2026-09-08T00:00:00.000Z';
const resetMonth = '2026-10-01T00:00:00.000Z';

describe('parseKimiCodingUsageWindows', () => {
  it('按 5h、7d、mo 映射 used_ratio 与合法 reset_time', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_5h: { used_ratio: 0.251, reset_time: reset5h },
          limit_7d: { used_ratio: 0, reset_time: reset7d },
          limit_month_total: { used_ratio: 1, reset_time: resetMonth },
        },
        boosterWallet: null,
      })
    ).toEqual([
      { label: '5h', usedPercent: 26, resetsAt: Date.parse(reset5h) },
      { label: '7d', usedPercent: 0, resetsAt: Date.parse(reset7d) },
      { label: 'mo', usedPercent: 100, resetsAt: Date.parse(resetMonth) },
    ]);
  });

  it('缺条目跳过，剩余窗口仍按 5h、7d、mo 顺序', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_month_total: { used_ratio: 0.5, reset_time: resetMonth },
          limit_7d: { used_ratio: 0.25, reset_time: reset7d },
        },
      })
    ).toEqual([
      { label: '7d', usedPercent: 25, resetsAt: Date.parse(reset7d) },
      { label: 'mo', usedPercent: 50, resetsAt: Date.parse(resetMonth) },
    ]);
  });

  it('used_ratio 接受数字字符串', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_5h: { used_ratio: '0.125', reset_time: reset5h },
          limit_7d: { used_ratio: '1', reset_time: reset7d },
          limit_month_total: { used_ratio: '0' },
        },
      })
    ).toEqual([
      { label: '5h', usedPercent: 13, resetsAt: Date.parse(reset5h) },
      { label: '7d', usedPercent: 100, resetsAt: Date.parse(reset7d) },
      { label: 'mo', usedPercent: 0 },
    ]);
  });

  it('缺失、非数或 NaN 的条目跳过，合法兄弟仍保留', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_5h: { reset_time: reset5h },
          limit_7d: { used_ratio: 'nope', reset_time: reset7d },
          limit_month_total: { used_ratio: Number.NaN },
        },
      })
    ).toEqual([]);
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_5h: null,
          limit_7d: { used_ratio: {}, reset_time: reset7d },
          limit_month_total: { used_ratio: 0.4, reset_time: resetMonth },
        },
      })
    ).toEqual([{ label: 'mo', usedPercent: 40, resetsAt: Date.parse(resetMonth) }]);
  });

  it('used_ratio 先钳到 [0,1] 再向上取整到百分比，非零至少 1%', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_5h: { used_ratio: -0.2, reset_time: reset5h },
          limit_7d: { used_ratio: 1.8, reset_time: reset7d },
          limit_month_total: { used_ratio: 0.0001, reset_time: resetMonth },
        },
      })
    ).toEqual([
      { label: '5h', usedPercent: 0, resetsAt: Date.parse(reset5h) },
      { label: '7d', usedPercent: 100, resetsAt: Date.parse(reset7d) },
      { label: 'mo', usedPercent: 1, resetsAt: Date.parse(resetMonth) },
    ]);
  });

  it('非法或缺失的 reset_time 省略 resetsAt', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_5h: { used_ratio: 0.2, reset_time: 'not-a-date' },
          limit_7d: { used_ratio: 0.2, reset_time: '' },
          limit_month_total: { used_ratio: 0.2 },
        },
      })
    ).toEqual([
      { label: '5h', usedPercent: 20 },
      { label: '7d', usedPercent: 20 },
      { label: 'mo', usedPercent: 20 },
    ]);
  });

  it('payload 或 usages 不是对象时返回空数组', () => {
    for (const payload of [null, undefined, 1, 'usage', [], { usages: null }, { usages: [] }, {}]) {
      expect(parseKimiCodingUsageWindows(payload)).toEqual([]);
    }
  });

  it('忽略 limit_month_code，即使它是唯一用量', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_month_code: { used_ratio: 0.9, reset_time: resetMonth },
          limit_5h: { used_ratio: 0.1, reset_time: reset5h },
        },
      })
    ).toEqual([{ label: '5h', usedPercent: 10, resetsAt: Date.parse(reset5h) }]);
    expect(
      parseKimiCodingUsageWindows({
        usages: { limit_month_code: { used_ratio: 0.9, reset_time: resetMonth } },
      })
    ).toEqual([]);
  });
});

describe('parseKimiCodingUsageWindows 浮点回归', () => {
  // 0.07/0.14/0.28 的 ×100 结果在整数上方一个 ulp，直接 ceil 会系统性多报 1%（review M1）
  it('×100 落在整数上方一个 ulp 的 ratio 不多报 1%', () => {
    expect(
      parseKimiCodingUsageWindows({
        usages: {
          limit_5h: { used_ratio: 0.07, reset_time: reset5h },
          limit_7d: { used_ratio: 0.14, reset_time: reset7d },
          limit_month_total: { used_ratio: 0.28, reset_time: resetMonth },
        },
      })
    ).toEqual([
      { label: '5h', usedPercent: 7, resetsAt: Date.parse(reset5h) },
      { label: '7d', usedPercent: 14, resetsAt: Date.parse(reset7d) },
      { label: 'mo', usedPercent: 28, resetsAt: Date.parse(resetMonth) },
    ]);
  });
});

describe('kimiCodingBearerToken', () => {
  it('从 Authorization 头解出 Bearer token，大小写不敏感', () => {
    expect(kimiCodingBearerToken({ Authorization: 'Bearer kimi-access-token' })).toBe(
      'kimi-access-token'
    );
    expect(kimiCodingBearerToken({ authorization: 'bearer  abc' })).toBe('abc');
  });

  it('缺头、空串或非 Bearer 方案时返回 undefined', () => {
    expect(kimiCodingBearerToken(undefined)).toBeUndefined();
    expect(kimiCodingBearerToken({})).toBeUndefined();
    expect(kimiCodingBearerToken({ Authorization: '' })).toBeUndefined();
    expect(kimiCodingBearerToken({ Authorization: 'Basic xyz' })).toBeUndefined();
    expect(kimiCodingBearerToken({ Authorization: null })).toBeUndefined();
  });
});
