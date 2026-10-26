import type { MaskAction } from './settings';

export const MASK_WHERE = [
  'system',
  'user',
  'tool_result',
  'tool_args',
  'assistant',
  'tools',
] as const;
export type MaskWhere = (typeof MASK_WHERE)[number];

/** 只含可公开信息：绝不放原值 */
export interface MaskHit {
  kind: string;
  rule: string;
  action: MaskAction;
  where: MaskWhere;
  /** 占位符哈希，用于区分不同值 */
  token: string;
  /** 前缀 + 长度，如 `sk-…(51)` */
  preview: string;
  count: number;
}

export interface MaskReport {
  hits: MaskHit[];
  blocked: boolean;
  restored: number;
}

export class MaskReportBuilder {
  private readonly hits = new Map<string, MaskHit>();
  blocked = false;
  restored = 0;

  add(hit: Omit<MaskHit, 'count'>, count = 1): void {
    const key = `${hit.kind}\0${hit.rule}\0${hit.action}\0${hit.where}\0${hit.token}`;
    const prev = this.hits.get(key);
    if (prev) prev.count += count;
    else this.hits.set(key, { ...hit, count });
  }

  get empty(): boolean {
    return this.hits.size === 0 && this.restored === 0;
  }

  build(): MaskReport {
    return {
      hits: [...this.hits.values()].map((h) => ({ ...h })),
      blocked: this.blocked,
      restored: this.restored,
    };
  }
}

const ACTIONS = new Set(['mask', 'warn', 'block']);
const WHERE = new Set<string>(MASK_WHERE);
const short = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function parseHit(value: unknown): MaskHit | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const h = value as Record<string, unknown>;
  if (
    !short(h.kind, 32) ||
    !/^[A-Z][A-Z_]*$/.test(h.kind) ||
    !short(h.rule, 32) ||
    !ACTIONS.has(h.action as string) ||
    !WHERE.has(h.where as string) ||
    !short(h.token, 16) ||
    !/^[a-z2-7]+$/.test(h.token) ||
    !short(h.preview, 40) ||
    !count(h.count)
  )
    return undefined;
  return {
    kind: h.kind,
    rule: h.rule,
    action: h.action as MaskAction,
    where: h.where as MaskWhere,
    token: h.token,
    preview: h.preview,
    count: h.count,
  };
}

/** 跨进程 / 落盘读回的报告按白名单重建，未知字段一律丢弃 */
export function parseMaskReport(value: unknown): MaskReport | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.hits) || typeof r.blocked !== 'boolean' || !count(r.restored))
    return undefined;
  const hits = r.hits.slice(0, 200).flatMap((h) => parseHit(h) ?? []);
  return { hits, blocked: r.blocked, restored: r.restored };
}

export function mergeMaskReports(a: MaskReport | undefined, b: MaskReport): MaskReport {
  if (!a) return b;
  const builder = new MaskReportBuilder();
  for (const h of [...a.hits, ...b.hits]) builder.add(h, h.count);
  builder.blocked = a.blocked || b.blocked;
  builder.restored = a.restored + b.restored;
  return builder.build();
}

// warn 意味着原文已发出，比 mask 更需要注意
const SEVERITY: Record<MaskAction, number> = { mask: 1, warn: 2, block: 3 };
export function strongestAction(report: MaskReport): MaskAction | undefined {
  let best: MaskAction | undefined;
  for (const h of report.hits) if (!best || SEVERITY[h.action] > SEVERITY[best]) best = h.action;
  return best;
}

export const PRIVACY_MASK_ENTRY = 'enso-privacy-mask';
export type MaskSource = 'session' | 'compaction' | 'aux';

/** 一次模型请求的脱敏记录；会话内落 custom entry，会话外写 Main ledger */
export interface PrivacyMaskRecord {
  at: number;
  provider: string;
  model: string;
  source: MaskSource;
  sessionId?: string;
  report: MaskReport;
}

export function parsePrivacyMaskRecord(value: unknown): PrivacyMaskRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  const report = parseMaskReport(r.report);
  if (
    !report ||
    !count(r.at) ||
    !short(r.provider, 200) ||
    !short(r.model, 200) ||
    (r.source !== 'session' && r.source !== 'compaction' && r.source !== 'aux') ||
    (r.sessionId !== undefined && !short(r.sessionId, 200))
  )
    return undefined;
  return {
    at: r.at,
    provider: r.provider,
    model: r.model,
    source: r.source,
    ...(r.sessionId !== undefined ? { sessionId: r.sessionId as string } : {}),
    report,
  };
}
