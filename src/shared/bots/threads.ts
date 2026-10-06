import type { BotChat } from '../types/bot';
import { splitChatReferences } from './composerRefs';
import { stripBotNotesUpdate } from './notes';

const TITLE_CHARS = 30;

/** 话题缺省标题：首条人类消息的首个非空行 */
export function threadTitleFrom(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((item) => item.replace(/\s+/gu, ' ').trim())
    .find(Boolean);
  if (!line) return undefined;
  const chars = [...line];
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS).join('')}…` : line;
}

const SKILL_BLOCK = /<skill name="[^"]*" location="[^"]*">[\s\S]*?<\/skill>/g;
const ROUTINE_TITLE = /^\s*<routine title="([^"]*)"/;

/** 私聊对话标题：首条用户消息去掉 Main 追加的块后取首行；例行取例行标题 */
export function sessionTitleFrom(text: string): string | undefined {
  const body = splitChatReferences(stripBotNotesUpdate(text)).body;
  const routine = ROUTINE_TITLE.exec(body)?.[1];
  return threadTitleFrom(routine ?? body.replace(SKILL_BLOCK, ''));
}

type ThreadChat = Pick<BotChat, 'id' | 'parentId' | 'activeThreadId' | 'createdAt'>;

/** 根群自身在前，其余话题按创建顺序 */
export function chatThreads<T extends ThreadChat>(chats: readonly T[], root: T): T[] {
  return [
    root,
    ...chats.filter((chat) => chat.parentId === root.id).sort((a, b) => a.createdAt - b.createdAt),
  ];
}

/** 根群当前话题；未设置或已删除时为根群 */
export function activeThreadOf<T extends ThreadChat>(chats: readonly T[], root: T): T {
  const active = root.activeThreadId
    ? chats.find((chat) => chat.id === root.activeThreadId && chat.parentId === root.id)
    : undefined;
  return active ?? root;
}

export const THREAD_MENU_LIMIT = 10;

export type ThreadFilter = 'all' | 'unread' | 'running';

interface ThreadEntry {
  id: string;
  title: string;
  preview?: string;
  activityAt: number;
  unread: boolean;
  running: boolean;
}

const byActivity = <T extends ThreadEntry>(entries: readonly T[]) =>
  [...entries].sort((a, b) => b.activityAt - a.activityAt);

/**
 * 下拉菜单里的话题：主话题与当前话题必留，其次未读 / 进行中，再按最近活动补足到上限。
 * 主话题排第一，其余按最近活动倒序。
 */
export function menuThreads<T extends ThreadEntry>(
  entries: readonly T[],
  keep: { currentId: string; rootId: string },
  limit = THREAD_MENU_LIMIT
): T[] {
  const recent = byActivity(entries);
  const rank = (entry: T) =>
    entry.id === keep.currentId || entry.id === keep.rootId
      ? 0
      : entry.unread || entry.running
        ? 1
        : 2;
  const picked = new Set(
    [...recent]
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, limit)
      .map((entry) => entry.id)
  );
  return recent
    .filter((entry) => picked.has(entry.id))
    .sort((a, b) => Number(b.id === keep.rootId) - Number(a.id === keep.rootId));
}

/** 全部话题弹窗：按最近活动倒序，标题 / 预览不区分大小写搜索，可只看未读或进行中 */
export function filterThreads<T extends ThreadEntry>(
  entries: readonly T[],
  query: string,
  filter: ThreadFilter
): T[] {
  const needle = query.trim().toLowerCase();
  return byActivity(entries).filter(
    (entry) =>
      (filter === 'all' || (filter === 'unread' ? entry.unread : entry.running)) &&
      (!needle || `${entry.title}\n${entry.preview ?? ''}`.toLowerCase().includes(needle))
  );
}
