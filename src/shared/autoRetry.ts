/** 自动重试次数：0 关闭，-1 无限（worker 内存覆盖为 Infinity，不写入 pi settings.json） */
export const UNLIMITED_AUTO_RETRY = -1;
export const DEFAULT_AUTO_RETRY_LIMIT = 3;
export const MAX_AUTO_RETRY_LIMIT = 100;
export const AUTO_RETRY_LIMIT_OPTIONS = [0, 3, 5, 10, 20, UNLIMITED_AUTO_RETRY] as const;

export function parseAutoRetryLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= UNLIMITED_AUTO_RETRY && value <= MAX_AUTO_RETRY_LIMIT ? value : null;
}

export function normalizeAutoRetryLimit(value: unknown): number {
  return parseAutoRetryLimit(value) ?? DEFAULT_AUTO_RETRY_LIMIT;
}

export function autoRetryOverrides(limit: number): { enabled: boolean; maxRetries: number } {
  if (limit === 0) return { enabled: false, maxRetries: 0 };
  return {
    enabled: true,
    maxRetries: limit === UNLIMITED_AUTO_RETRY ? Number.POSITIVE_INFINITY : limit,
  };
}
