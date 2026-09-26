import { describe, expect, it } from 'vitest';
import { toUsageTotals } from './sessionStats';

const base = {
  turns: 1,
  steps: 1,
  llmMs: 0,
  toolMs: 0,
  inputTokens: 300,
  outputTokens: 10,
  cacheHitPercent: null,
  ttftAvgMs: null,
  tokensPerSecond: null,
};

describe('toUsageTotals', () => {
  it('只保留状态栏四段所需字段，null 不输出', () => {
    expect(toUsageTotals(base)).toEqual({ inputTokens: 300, outputTokens: 10 });
  });

  it('有采样时带上缓存命中与速度', () => {
    expect(
      toUsageTotals({ ...base, cacheHitPercent: 63, ttftAvgMs: 800, tokensPerSecond: 42.5 })
    ).toEqual({
      inputTokens: 300,
      outputTokens: 10,
      cacheHitPercent: 63,
      ttftAvgMs: 800,
      tokensPerSecond: 42.5,
    });
  });
});
