import { translate } from '@shared/i18n';
import type { BotQueueItem } from '@shared/types/botIpc';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BotLiveStatus } from './BotLiveStatus';

const store = vi.hoisted(() => ({
  queue: [] as BotQueueItem[],
  locale: 'zh' as 'zh' | 'en',
}));
vi.mock('@/stores/bots', () => ({
  useBotsStore: (select: (state: unknown) => unknown) =>
    select({ sessions: {}, queue: store.queue }),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => translate(store.locale, key) }),
}));

const render = () => renderToStaticMarkup(createElement(BotLiveStatus, { conversationId: 'c' }));
const queued = (reason?: BotQueueItem['reason']): BotQueueItem => ({
  chatId: 'g',
  botId: 'b',
  conversationId: 'c',
  position: 0,
  reason,
});

describe('BotLiveStatus queue reasons', () => {
  beforeEach(() => {
    store.queue = [];
    store.locale = 'zh';
  });

  it.each([
    ['member-check', '正在判断是否可并行', 'checking whether tasks can run in parallel'],
    ['member-serial', '等待成员当前任务完成', "waiting for the member's current task to finish"],
    ['member-fifo', '等待成员前序任务', "waiting for the member's earlier tasks"],
    ['member-stopping', '等待成员停止完成', 'waiting for the member to stop'],
    ['turn', '等上一轮结束', 'waiting for the current turn to finish'],
    ['capacity', '并发已满', 'concurrency limit reached'],
  ] as const)('renders fixed localized text for %s', (reason, zh, en) => {
    store.queue = [queued(reason)];
    expect(render()).toContain(`排队中 · ${zh}`);
    store.locale = 'en';
    expect(render()).toContain(`Queued · ${en.replaceAll("'", '&#x27;')}`);
  });

  it('does not render unknown model reasons or another conversation', () => {
    store.queue = [queued('private model explanation' as BotQueueItem['reason'])];
    expect(render()).toContain('排队');
    expect(render()).not.toContain('private model explanation');
    store.queue = [
      { ...queued('member-serial'), conversationId: 'other', task: 'private task' } as BotQueueItem,
    ];
    expect(render()).not.toContain('排队');
    expect(render()).not.toContain('private task');
  });
});
