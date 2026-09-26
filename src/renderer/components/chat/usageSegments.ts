import type { ContextUsage } from '@shared/types';
import type { ContextOccupancy, SessionUsageTotals } from '@shared/types/agent';
import type { TFunction } from '@/i18n';
import { formatDuration, formatTokens } from '@/stores/sessions/stats';
import { contextSegmentUsed } from './contextSegment';

/** 段位当前值：`compact` 是状态栏内联展示（紧凑，可为空串走纯 icon），
 *  `full` 是设置弹层预览用的完整句子（不含段名前缀，行内已单独显示段名）。
 *  `percent`：仅 `context` 段在窗口已知时设置，驱动图形环；`critical`：该段是否需要警示色。 */
export interface SegmentValue {
  compact: string;
  full: string;
  percent?: number;
  critical?: boolean;
}

/** 状态栏对「资源即将耗尽」统一用的警戒阈值：占用/额度达到或超过此百分比即判定紧张，标红提示 */
export const CRITICAL_PERCENT = 90;

export type UsageSegmentId = 'tokens' | 'cache' | 'context' | 'speed';

/** 状态栏 token/缓存/速度/上下文四段的数据 */
export interface SessionUsageStats extends SessionUsageTotals {
  contextUsed?: number;
  contextWindow?: number;
}

/** 占用窗口优先、会话窗口其次；都未知时只给已用量，不编造窗口 */
export function resolveContextUsage(
  occupancy?: Pick<ContextOccupancy, 'used' | 'contextWindow'> | null,
  contextWindow?: number
): ContextUsage | undefined {
  const used = contextSegmentUsed(occupancy);
  if (used === null) return undefined;
  const window =
    occupancy?.contextWindow && occupancy.contextWindow > 0
      ? occupancy.contextWindow
      : contextWindow && contextWindow > 0
        ? contextWindow
        : 0;
  return window > 0 ? { used, window } : { used };
}

/** 桌面与手机状态栏共用的数据口径：用量与占用合成四段数据；全空时不产值 */
export function toSessionUsageStats(
  totals: SessionUsageTotals | undefined,
  context?: ContextUsage
): SessionUsageStats | undefined {
  const out: SessionUsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    ...totals,
  };
  if (context) {
    out.contextUsed = context.used;
    if (context.window !== undefined) out.contextWindow = context.window;
  }
  const empty =
    out.inputTokens === 0 &&
    out.outputTokens === 0 &&
    out.cacheHitPercent === undefined &&
    out.ttftAvgMs === undefined &&
    out.tokensPerSecond === undefined &&
    out.contextUsed === undefined;
  return empty ? undefined : out;
}

export function buildUsageSegmentValues(
  t: TFunction,
  usage: SessionUsageStats | undefined
): Record<UsageSegmentId, SegmentValue | undefined> {
  const values: Record<UsageSegmentId, SegmentValue | undefined> = {
    tokens: undefined,
    cache: undefined,
    context: undefined,
    speed: undefined,
  };
  if (!usage) return values;

  if (usage.contextUsed !== undefined) {
    const used = usage.contextUsed;
    const window = usage.contextWindow ?? 0;
    // 窗口未知时不编造百分比：显示已用 tokens，用 `?` 表示窗口未知，而不是拿一个假窗口凑百分比
    if (window > 0) {
      const percent = Math.min(100, Math.round((used / window) * 100));
      values.context = {
        compact: `${percent}%`,
        full: `${formatTokens(window)} · ${percent}%`,
        percent,
        critical: percent >= CRITICAL_PERCENT,
      };
    } else {
      values.context = {
        compact: `${formatTokens(used)}·?`,
        full: `${formatTokens(used)} · ?`,
      };
    }
  }

  const speedCompact: string[] = [];
  const speedFull: string[] = [];
  if (usage.ttftAvgMs !== undefined) {
    speedCompact.push(formatDuration(usage.ttftAvgMs));
    speedFull.push(
      t('First token avg {{duration}}', { duration: formatDuration(usage.ttftAvgMs) })
    );
  }
  if (usage.tokensPerSecond !== undefined) {
    speedCompact.push(`${usage.tokensPerSecond} tok/s`);
    speedFull.push(t('{{speed}} tok/s', { speed: usage.tokensPerSecond }));
  }
  if (speedCompact.length > 0) {
    values.speed = { compact: speedCompact.join(' · '), full: speedFull.join(' · ') };
  }

  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    values.tokens = {
      compact: `↑${formatTokens(usage.inputTokens)} ↓${formatTokens(usage.outputTokens)}`,
      full: t('Input {{input}} tok · Output {{output}} tok', {
        input: formatTokens(usage.inputTokens),
        output: formatTokens(usage.outputTokens),
      }),
    };
  }

  if (usage.cacheHitPercent !== undefined) {
    values.cache = {
      compact: `${usage.cacheHitPercent}%`,
      full: t('Cache hit {{percent}}%', { percent: usage.cacheHitPercent }),
    };
  }

  return values;
}
