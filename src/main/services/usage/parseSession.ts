import type { ActivitySpan } from '@shared/usage/aggregate';
import type { UsageRecord } from '@shared/usage/types';

export interface ParsedSession {
  sessionId: string;
  project: string;
  /** session 头 cwd，用量按项目归并时用来识别 worktree */
  cwd?: string;
  records: UsageRecord[];
  /** 每轮 [user ts, 该轮最后一条 assistant/toolResult ts]，单轮上限 6h */
  spans: ActivitySpan[];
  /** Σ spans */
  activeMs: number;
  userMessages: number;
}

const TURN_CAP_MS = 6 * 60 * 60 * 1000;

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function basename(cwd: unknown): string {
  if (typeof cwd !== 'string') return '';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function entryTs(entry: Record<string, unknown>, message: Record<string, unknown>): number | null {
  if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
    return message.timestamp;
  }
  if (typeof entry.timestamp === 'string') {
    const parsed = Date.parse(entry.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** 落盘的 ParsedSession（账本 / 解析缓存）读回时的结构收窄；缺 sessionId 或 records 视为坏数据 */
export function coerceParsedSession(raw: unknown): ParsedSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<ParsedSession>;
  if (typeof value.sessionId !== 'string' || !Array.isArray(value.records)) return null;
  return {
    sessionId: value.sessionId,
    project: typeof value.project === 'string' ? value.project : '',
    ...(typeof value.cwd === 'string' && value.cwd ? { cwd: value.cwd } : {}),
    records: value.records,
    spans: Array.isArray(value.spans) ? value.spans : [],
    activeMs: typeof value.activeMs === 'number' ? value.activeMs : 0,
    userMessages: typeof value.userMessages === 'number' ? value.userMessages : 0,
  };
}

/** pi session v3 jsonl → 用量记录。坏行跳过；无 session 头返回 null。输出语义变化须递增 parseCache 的 CACHE_VERSION。 */
export function parseSessionJsonl(text: string): ParsedSession | null {
  let sessionId: string | null = null;
  let project = '';
  let cwd = '';
  const records = new Map<string, UsageRecord>();
  let userMessages = 0;
  const spans: ActivitySpan[] = [];
  let turnStart: number | null = null;
  let turnEnd: number | null = null;
  let anonymous = 0;

  const closeTurn = () => {
    if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
      spans.push({ start: turnStart, end: Math.min(turnEnd, turnStart + TURN_CAP_MS) });
    }
    turnStart = null;
    turnEnd = null;
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    if (e.type === 'session') {
      if (typeof e.id === 'string') sessionId = e.id;
      if (typeof e.cwd === 'string') {
        cwd = e.cwd;
        project = basename(e.cwd);
      }
      continue;
    }
    if (e.type !== 'message' || !e.message || typeof e.message !== 'object') continue;
    const message = e.message as Record<string, unknown>;
    const ts = entryTs(e, message);

    if (message.role === 'user') {
      userMessages += 1;
      closeTurn();
      turnStart = ts;
      continue;
    }
    if (message.role === 'assistant' || message.role === 'toolResult') {
      if (ts !== null && turnStart !== null) turnEnd = ts;
    }
    if (message.role !== 'assistant') continue;
    const usage = message.usage;
    if (!usage || typeof usage !== 'object' || ts === null) continue;
    const u = usage as Record<string, unknown>;
    const key = typeof e.id === 'string' ? e.id : `#${anonymous++}`;
    records.set(key, {
      id: key,
      ts,
      model: str(message.model, 'unknown'),
      provider: str(message.provider, ''),
      project,
      sessionId: sessionId ?? '',
      input: num(u.input),
      output: num(u.output),
      cacheRead: num(u.cacheRead),
      cacheWrite: num(u.cacheWrite),
      reasoning: num(u.reasoning),
    });
  }
  closeTurn();

  if (sessionId === null) return null;
  // session 头可能晚于首条消息出现；统一回填
  for (const r of records.values()) {
    r.sessionId = sessionId;
    r.project = project;
  }
  const activeMs = spans.reduce((sum, span) => sum + (span.end - span.start), 0);
  return {
    sessionId,
    project,
    ...(cwd ? { cwd } : {}),
    records: [...records.values()],
    spans,
    activeMs,
    userMessages,
  };
}
