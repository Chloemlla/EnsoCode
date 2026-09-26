import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SSH_TIMEOUT_SECONDS,
  MAX_SSH_TIMEOUT_SECONDS,
  MIN_SSH_TIMEOUT_SECONDS,
  normalizeSshTimeoutSeconds,
  parseSshTimeoutSeconds,
} from './sshTimeout';

describe('normalizeSshTimeoutSeconds', () => {
  it('缺省、脏值和小数都回落到 30', () => {
    expect(DEFAULT_SSH_TIMEOUT_SECONDS).toBe(30);
    expect(normalizeSshTimeoutSeconds(undefined)).toBe(30);
    expect(normalizeSshTimeoutSeconds(null)).toBe(30);
    expect(normalizeSshTimeoutSeconds('60')).toBe(30);
    expect(normalizeSshTimeoutSeconds(12.5)).toBe(30);
    expect(normalizeSshTimeoutSeconds(Number.NaN)).toBe(30);
  });

  it('整数夹到上下限', () => {
    expect(normalizeSshTimeoutSeconds(60)).toBe(60);
    expect(normalizeSshTimeoutSeconds(0)).toBe(MIN_SSH_TIMEOUT_SECONDS);
    expect(normalizeSshTimeoutSeconds(-1)).toBe(MIN_SSH_TIMEOUT_SECONDS);
    expect(normalizeSshTimeoutSeconds(99_999)).toBe(MAX_SSH_TIMEOUT_SECONDS);
  });
});

describe('parseSshTimeoutSeconds', () => {
  it('只接受闭区间内的整数', () => {
    expect(parseSshTimeoutSeconds(MIN_SSH_TIMEOUT_SECONDS)).toBe(MIN_SSH_TIMEOUT_SECONDS);
    expect(parseSshTimeoutSeconds(MAX_SSH_TIMEOUT_SECONDS)).toBe(MAX_SSH_TIMEOUT_SECONDS);
    expect(parseSshTimeoutSeconds(MIN_SSH_TIMEOUT_SECONDS - 1)).toBeNull();
    expect(parseSshTimeoutSeconds(MAX_SSH_TIMEOUT_SECONDS + 1)).toBeNull();
    expect(parseSshTimeoutSeconds(30.5)).toBeNull();
    expect(parseSshTimeoutSeconds('30')).toBeNull();
  });
});
