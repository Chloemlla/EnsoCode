import { describe, expect, it } from 'vitest';
import { buildUsageSegmentValues, resolveContextUsage, toSessionUsageStats } from './usageSegments';

const t = (key: string, params?: Record<string, string | number>) =>
  key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''));

describe('resolveContextUsage', () => {
  it('无占用时不产值', () => {
    expect(resolveContextUsage(undefined, 128_000)).toBeUndefined();
  });

  it('占用窗口优先；占用无窗口时回落会话窗口；两者都未知时只给已用量', () => {
    expect(resolveContextUsage({ used: 5000, contextWindow: 200_000 }, 128_000)).toEqual({
      used: 5000,
      window: 200_000,
    });
    expect(resolveContextUsage({ used: 10 }, 128_000)).toEqual({ used: 10, window: 128_000 });
    expect(resolveContextUsage({ used: 0, contextWindow: 0 }, 0)).toEqual({ used: 0 });
  });
});

describe('toSessionUsageStats', () => {
  it('无用量、无速度、无占用时不产值', () => {
    expect(toSessionUsageStats(undefined)).toBeUndefined();
    expect(toSessionUsageStats({ inputTokens: 0, outputTokens: 0 })).toBeUndefined();
  });

  it('合入上下文占用', () => {
    expect(
      toSessionUsageStats(
        { inputTokens: 1200, outputTokens: 30, cacheHitPercent: 80, tokensPerSecond: 42.5 },
        { used: 5000, window: 200_000 }
      )
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 30,
      cacheHitPercent: 80,
      tokensPerSecond: 42.5,
      contextUsed: 5000,
      contextWindow: 200_000,
    });
  });

  it('只有占用时仍产值（worker 尚未产出统计）', () => {
    expect(toSessionUsageStats(undefined, { used: 0 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      contextUsed: 0,
    });
  });
});

describe('buildUsageSegmentValues', () => {
  it('无数据时四段均为空', () => {
    expect(buildUsageSegmentValues(t, undefined)).toEqual({
      tokens: undefined,
      cache: undefined,
      context: undefined,
      speed: undefined,
    });
  });

  it('与桌面状态栏同口径格式化四段', () => {
    const values = buildUsageSegmentValues(t, {
      inputTokens: 12_345,
      outputTokens: 678,
      cacheHitPercent: 87,
      ttftAvgMs: 1234,
      tokensPerSecond: 45.3,
      contextUsed: 185_000,
      contextWindow: 200_000,
    });
    expect(values.tokens).toEqual({
      compact: '↑12.3K ↓678',
      full: 'Input 12.3K tok · Output 678 tok',
    });
    expect(values.cache).toEqual({ compact: '87%', full: 'Cache hit 87%' });
    expect(values.context).toEqual({
      compact: '93%',
      full: '200K · 93%',
      percent: 93,
      critical: true,
    });
    expect(values.speed).toEqual({
      compact: '1.2s · 45.3 tok/s',
      full: 'First token avg 1.2s · 45.3 tok/s',
    });
  });

  it('窗口未知时上下文不编造百分比', () => {
    expect(
      buildUsageSegmentValues(t, { inputTokens: 0, outputTokens: 0, contextUsed: 4200 }).context
    ).toEqual({ compact: '4.2K·?', full: '4.2K · ?' });
  });

  it('占用超过窗口时百分比封顶 100', () => {
    expect(
      buildUsageSegmentValues(t, {
        inputTokens: 0,
        outputTokens: 0,
        contextUsed: 300,
        contextWindow: 200,
      }).context?.percent
    ).toBe(100);
  });
});
