import { describe, expect, it } from 'vitest';
import type { BotChat } from '../types/bot';
import { activeThreadOf, chatThreads, threadTitleFrom } from './threads';

describe('threadTitleFrom', () => {
  it('取首个非空行，压缩空白，超长截断加省略号', () => {
    expect(threadTitleFrom('\n  发布   清单\n第二行')).toBe('发布 清单');
    expect(threadTitleFrom('a'.repeat(40))).toBe(`${'a'.repeat(30)}…`);
    expect(threadTitleFrom('   \n ')).toBeUndefined();
  });
});

describe('群话题列表', () => {
  const chat = (id: string, extra: Partial<BotChat> = {}) =>
    ({ id, kind: 'group', createdAt: Number(id.at(-1)), ...extra }) as BotChat;
  const root = chat('r0', { activeThreadId: 't2' });
  const chats = [chat('t2', { parentId: 'r0' }), root, chat('x3'), chat('t1', { parentId: 'r0' })];

  it('根群在前、话题按创建顺序；当前话题失效时回到根群', () => {
    expect(chatThreads(chats, root).map((item) => item.id)).toEqual(['r0', 't1', 't2']);
    expect(activeThreadOf(chats, root).id).toBe('t2');
    expect(activeThreadOf(chats, { ...root, activeThreadId: 'x3' }).id).toBe('r0');
    expect(activeThreadOf(chats, { ...root, activeThreadId: undefined }).id).toBe('r0');
  });
});
