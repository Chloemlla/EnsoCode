import { describe, expect, it } from 'vitest';
import type { BotChat } from '../types/bot';
import {
  activeThreadOf,
  chatThreads,
  filterThreads,
  menuThreads,
  threadTitleFrom,
} from './threads';

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

describe('话题下拉与全部话题弹窗', () => {
  const entry = (
    id: string,
    activityAt: number,
    extra: { unread?: boolean; running?: boolean } = {}
  ) => ({
    id,
    title: `topic ${id}`,
    preview: '',
    activityAt,
    unread: false,
    running: false,
    ...extra,
  });
  const ids = (items: { id: string }[]) => items.map((item) => item.id);

  it('不超过上限时全部展示：主话题在前，其余按最近活动倒序', () => {
    const items = [entry('root', 1), entry('a', 5), entry('b', 9)];
    expect(ids(menuThreads(items, { currentId: 'a', rootId: 'root' }))).toEqual(['root', 'b', 'a']);
  });

  it('超过上限时保留当前、主话题、未读与进行中，再按最近活动补足', () => {
    const items = [
      entry('root', 0),
      entry('old-current', 1),
      entry('old-unread', 2, { unread: true }),
      entry('old-running', 3, { running: true }),
      ...Array.from({ length: 20 }, (_, i) => entry(`r${i}`, 100 + i)),
    ];
    const shown = menuThreads(items, { currentId: 'old-current', rootId: 'root' }, 6);
    expect(ids(shown)).toEqual(['root', 'r19', 'r18', 'old-running', 'old-unread', 'old-current']);
  });

  it('必留话题本身超过上限时，主话题与当前话题优先，未读按最近活动截断', () => {
    const items = [
      entry('root', 0),
      entry('current', 1),
      ...Array.from({ length: 5 }, (_, i) => entry(`u${i}`, 10 + i, { unread: true })),
    ];
    const shown = menuThreads(items, { currentId: 'current', rootId: 'root' }, 4);
    expect(ids(shown)).toEqual(['root', 'u4', 'u3', 'current']);
  });

  it('弹窗按最近活动倒序，可按标题 / 预览搜索并按未读、进行中筛选', () => {
    const items = [
      { ...entry('a', 1, { unread: true }), title: 'Release plan' },
      { ...entry('b', 3, { running: true }), preview: 'deploy RELEASE now' },
      entry('c', 2),
    ];
    expect(ids(filterThreads(items, '', 'all'))).toEqual(['b', 'c', 'a']);
    expect(ids(filterThreads(items, '  release ', 'all'))).toEqual(['b', 'a']);
    expect(ids(filterThreads(items, '', 'unread'))).toEqual(['a']);
    expect(ids(filterThreads(items, 'release', 'running'))).toEqual(['b']);
    expect(filterThreads(items, 'nothing', 'all')).toEqual([]);
  });
});
