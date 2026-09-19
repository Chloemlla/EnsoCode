export const COMPUTER_DEFAULT_TIMEOUT_SEC = 30;
export const COMPUTER_MAX_TIMEOUT_SEC = 120;
export const COORDINATE_SAFE_MAX_WIDTH = 1280;
export const COORDINATE_SAFE_MAX_HEIGHT = 896;

export interface ComputerRunParams {
  code: string;
  readOnly: boolean;
  timeoutSec: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function asTimeoutSec(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return COMPUTER_DEFAULT_TIMEOUT_SEC;
  return Math.min(Math.floor(n), COMPUTER_MAX_TIMEOUT_SEC);
}

/** schema 校验前把脏入参收成可执行形状；缺 code 返回 null。 */
export function normalizeComputerParams(value: unknown): ComputerRunParams | null {
  const record = asRecord(value);
  if (!record) return null;
  const code = typeof record.code === 'string' ? record.code : '';
  if (!code.trim()) return null;
  return {
    code,
    readOnly: asBoolean(record.read_only),
    timeoutSec: asTimeoutSec(record.timeout),
  };
}
