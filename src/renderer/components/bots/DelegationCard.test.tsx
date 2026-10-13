import { translate } from '@shared/i18n';
import type { BotProfile, Delegation } from '@shared/types/bot';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelegationCard } from './DelegationCard';

const store = vi.hoisted(() => ({ locale: 'zh' as 'zh' | 'en' }));
vi.mock('@/stores/bots', () => ({
  useBotsStore: (select: (state: unknown) => unknown) =>
    select({ delegations: [], sessions: {}, queue: [], silences: [] }),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      translate(store.locale, key, params),
  }),
}));

const bots = new Map([
  ['boss', { id: 'boss', name: '林经理', avatar: { color: '#888' } } as BotProfile],
  ['b1', { id: 'b1', name: 'Jason', avatar: { color: '#888' } } as BotProfile],
]);
const record = {
  id: 'd1',
  chatId: 'chat1',
  parentBotId: 'boss',
  targetBotId: 'b1',
  task: '断网提示条',
  childConversationId: 'k1',
  state: 'running',
  createdAt: Date.now() - 60_000,
  taskId: 't42',
  appends: [{ at: Date.now(), text: '顺便加个重连按钮', deliveryId: 'x1' }],
} as Delegation;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (taskSeq?: number) =>
  text(
    renderToStaticMarkup(
      createElement(DelegationCard, {
        record,
        append: record.appends?.[0],
        taskSeq,
        bots,
        onOpenConversation: () => {},
      })
    )
  );

describe('DelegationCard 并入的追加', () => {
  beforeEach(() => {
    store.locale = 'zh';
  });

  it('显示「已并入 #N 当前执行」与追加内容，不显示状态与取消', () => {
    const html = render(42);
    expect(html).toContain('林经理 → Jason');
    expect(html).toContain('已并入 #42 当前执行');
    expect(html).toContain('顺便加个重连按钮');
    expect(html).not.toContain('断网提示条');
    for (const label of ['进行中', '排队', '取消']) expect(html).not.toContain(label);
    expect(html).toContain('查看过程');
  });

  it('不知道任务号时只写并入当前执行；英文文案', () => {
    expect(render()).toContain('已并入当前执行');
    store.locale = 'en';
    expect(render(42)).toContain('Merged into the current run of #42');
    expect(render()).toContain('Merged into the current run');
  });
});
