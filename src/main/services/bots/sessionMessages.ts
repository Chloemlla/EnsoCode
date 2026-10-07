import { statSync } from 'node:fs';
import { open, stat as statAsync } from 'node:fs/promises';
import { sessionTitleFrom } from '@shared/bots/threads';
import type { ProjectedMessage } from '@shared/types/agent';
import { projectParentHistoryAll, resolveParentHistoryFile } from '../sessionHistoryTail';

const CACHE_LIMIT = 16;
const cache = new Map<string, { stamp: string; messages: readonly ProjectedMessage[] }>();

/**
 * bot 会话 jsonl 的全量投影（下标与历史分页同一编号），按 mtime+size 缓存；
 * 路径必须落在 sessions 目录内。搜索与产物卡片共用。
 */
export async function readBotSessionMessages(
  sessionDir: string,
  sessionFile: string | undefined
): Promise<readonly ProjectedMessage[]> {
  const resolved = resolveParentHistoryFile(sessionDir, sessionFile);
  if (!resolved) throw new Error('session file outside sessions directory');
  const stat = statSync(resolved);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(resolved);
  if (hit?.stamp === stamp) {
    cache.delete(resolved);
    cache.set(resolved, hit);
    return hit.messages;
  }
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const messages = projectParentHistoryAll(SessionManager.open(resolved, sessionDir).getBranch());
  cache.delete(resolved);
  cache.set(resolved, { stamp, messages });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return messages;
}

export interface BranchEntry {
  id: string;
  /** user 消息条目才有：消息时间（ms） */
  userAt?: number;
}

/** 当前分支的 entry 序列（回退校验目标、计算记忆水位与委派作废边界用） */
export async function readBotSessionBranch(
  sessionDir: string,
  sessionFile: string | undefined
): Promise<BranchEntry[]> {
  const resolved = resolveParentHistoryFile(sessionDir, sessionFile);
  if (!resolved) throw new Error('session file outside sessions directory');
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  return SessionManager.open(resolved, sessionDir)
    .getBranch()
    .map((entry) => {
      const message =
        entry.type === 'message' ? (entry.message as { role?: string; timestamp?: number }) : null;
      if (message?.role !== 'user') return { id: entry.id };
      const at =
        typeof message.timestamp === 'number' ? message.timestamp : Date.parse(entry.timestamp);
      return { id: entry.id, ...(Number.isFinite(at) ? { userAt: at } : {}) };
    });
}

const HEAD_BYTES = 256 * 1024;
const summaries = new Map<string, { stamp: string; title?: string }>();

export interface BotSessionSummary {
  title?: string;
  activityAt: number;
}

function userText(raw: string): string | undefined {
  try {
    const entry = JSON.parse(raw) as {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    if (entry.type !== 'message' || entry.message?.role !== 'user') return undefined;
    const { content } = entry.message;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return undefined;
    return content
      .filter((part): part is { type: 'text'; text: string } => part?.type === 'text')
      .map((part) => part.text)
      .join('\n');
  } catch {
    return undefined;
  }
}

/** 私聊对话列表摘要：只读文件头找首条用户消息作标题，修改时间作最后活动；按 mtime+size 缓存 */
export async function readBotSessionSummary(
  sessionDir: string,
  sessionFile: string | undefined
): Promise<BotSessionSummary | null> {
  const resolved = resolveParentHistoryFile(sessionDir, sessionFile);
  if (!resolved) return null;
  try {
    const info = await statAsync(resolved);
    const stamp = `${info.mtimeMs}:${info.size}`;
    const hit = summaries.get(resolved);
    if (hit?.stamp === stamp) return { title: hit.title, activityAt: info.mtimeMs };
    const handle = await open(resolved, 'r');
    let head: string;
    try {
      const buffer = Buffer.alloc(Math.min(HEAD_BYTES, info.size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
    const lines = head.split('\n');
    if (info.size > HEAD_BYTES) lines.pop();
    let title: string | undefined;
    for (const raw of lines) {
      const text = raw && userText(raw);
      if (text === undefined || text === '') continue;
      title = sessionTitleFrom(text);
      break;
    }
    summaries.set(resolved, { stamp, title });
    if (summaries.size > 512) summaries.delete(summaries.keys().next().value as string);
    return { title, activityAt: info.mtimeMs };
  } catch {
    return null;
  }
}
