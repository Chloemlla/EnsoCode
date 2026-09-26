export { computeStats, type SessionStats } from '@shared/sessionStats';

/** 紧凑 token 数：517 / 12.2K / 517K / 1.2M（不足三位保留一位小数） */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`;
  return `${scaled(n / 1_000_000)}M`;
}

/** 紧凑时长：不足 1 分钟 45.2s，其后 2m42s */
export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}
