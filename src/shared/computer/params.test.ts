import { describe, expect, it } from 'vitest';
import {
  COMPUTER_DEFAULT_TIMEOUT_SEC,
  COMPUTER_MAX_TIMEOUT_SEC,
  normalizeComputerParams,
  toComputerWireParams,
} from './params';

describe('normalizeComputerParams', () => {
  it('收对象和 JSON 字符串，缺 code 返回 null', () => {
    expect(normalizeComputerParams(null)).toBeNull();
    expect(normalizeComputerParams('code')).toBeNull();
    expect(normalizeComputerParams({})).toBeNull();
    expect(normalizeComputerParams({ code: '   ' })).toBeNull();
    expect(normalizeComputerParams({ code: 'return 1' })).toEqual({
      code: 'return 1',
      readOnly: false,
      timeoutSec: COMPUTER_DEFAULT_TIMEOUT_SEC,
    });
    expect(normalizeComputerParams('{"code":"await desktop.windows()","read_only":true}')).toEqual({
      code: 'await desktop.windows()',
      readOnly: true,
      timeoutSec: COMPUTER_DEFAULT_TIMEOUT_SEC,
    });
  });

  it('read_only 只认 true/"true"；timeout 钳到 1..max', () => {
    expect(normalizeComputerParams({ code: 'x', read_only: 'true' })?.readOnly).toBe(true);
    expect(normalizeComputerParams({ code: 'x', read_only: 1 })?.readOnly).toBe(false);
    expect(normalizeComputerParams({ code: 'x', timeout: 3.9 })?.timeoutSec).toBe(3);
    expect(normalizeComputerParams({ code: 'x', timeout: '15' })?.timeoutSec).toBe(15);
    expect(normalizeComputerParams({ code: 'x', timeout: 0 })?.timeoutSec).toBe(
      COMPUTER_DEFAULT_TIMEOUT_SEC
    );
    expect(normalizeComputerParams({ code: 'x', timeout: 999 })?.timeoutSec).toBe(
      COMPUTER_MAX_TIMEOUT_SEC
    );
  });
});

describe('toComputerWireParams', () => {
  it('worker→Main 往返后 read_only 与 timeout 不丢', () => {
    const normalized = normalizeComputerParams({ code: 'x', read_only: true, timeout: 12 });
    expect(normalized).not.toBeNull();
    expect(normalizeComputerParams(toComputerWireParams(normalized!))).toEqual({
      code: 'x',
      readOnly: true,
      timeoutSec: 12,
    });
  });
});
