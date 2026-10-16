import { describe, expect, it } from 'vitest';
import {
  autoRetryOverrides,
  DEFAULT_AUTO_RETRY_LIMIT,
  normalizeAutoRetryLimit,
  parseAutoRetryLimit,
  UNLIMITED_AUTO_RETRY,
} from './autoRetry';

describe('auto retry limit', () => {
  it('accepts off, unlimited and bounded integers', () => {
    expect(parseAutoRetryLimit(0)).toBe(0);
    expect(parseAutoRetryLimit(UNLIMITED_AUTO_RETRY)).toBe(UNLIMITED_AUTO_RETRY);
    expect(parseAutoRetryLimit(10)).toBe(10);
    expect(parseAutoRetryLimit(100)).toBe(100);
  });

  it.each([-2, 101, 2.5, '3', null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %j',
    (value) => {
      expect(parseAutoRetryLimit(value)).toBeNull();
      expect(normalizeAutoRetryLimit(value)).toBe(DEFAULT_AUTO_RETRY_LIMIT);
    }
  );

  it('maps to pi retry overrides', () => {
    expect(autoRetryOverrides(0)).toEqual({ enabled: false, maxRetries: 0 });
    expect(autoRetryOverrides(5)).toEqual({ enabled: true, maxRetries: 5 });
    expect(autoRetryOverrides(UNLIMITED_AUTO_RETRY)).toEqual({
      enabled: true,
      maxRetries: Number.POSITIVE_INFINITY,
    });
  });
});
