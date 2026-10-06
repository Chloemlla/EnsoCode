import type { BotChat } from '../types/bot';

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
