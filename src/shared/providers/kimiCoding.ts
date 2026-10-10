/**
 * Kimi Code 订阅用量：`GET https://api.kimi.com/coding/v1/usages`。
 * 只取 limit_5h / limit_7d / limit_month_total，limit_month_code 不是账号额度窗口。
 */
import type { OauthUsageWindow } from '@shared/types';

export const KIMI_CODING_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';

const WINDOWS = [
  ['limit_5h', '5h'],
  ['limit_7d', '7d'],
  ['limit_month_total', 'mo'],
] as const;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** used_ratio 只接受有限数字或数字字符串。 */
function usedRatio(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function resetsAt(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseKimiCodingUsageWindows(payload: unknown): OauthUsageWindow[] {
  const usages = record(record(payload)?.usages);
  if (!usages) return [];

  const windows: OauthUsageWindow[] = [];
  for (const [key, label] of WINDOWS) {
    const ratio = usedRatio(record(usages[key])?.used_ratio);
    if (ratio === null) continue;
    const clamped = Math.min(1, Math.max(0, ratio));
    // ceil 保留官方「非零至少 1%」语义；先减 1e-9 吃掉浮点尾差，
    // 否则 0.07*100=7.000000000000001 会被 ceil 成 8（review M1）。
    const usedPercent = clamped <= 0 ? 0 : Math.min(100, Math.ceil(clamped * 100 - 1e-9));
    const reset = resetsAt(record(usages[key])?.reset_time);
    windows.push({
      label,
      usedPercent,
      ...(reset !== undefined ? { resetsAt: reset } : {}),
    });
  }
  return windows;
}

/** kimi-coding OAuth 的 toAuth 只写 `Authorization: Bearer …`，没有 apiKey。 */
export function kimiCodingBearerToken(
  headers: Record<string, string | null> | undefined
): string | undefined {
  const raw = headers?.Authorization ?? headers?.authorization;
  if (!raw) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return match?.[1];
}
