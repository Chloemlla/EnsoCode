import { translate } from '@shared/i18n';
import type { BotProfile } from '@shared/types/bot';
import type { BotQueueItem } from '@shared/types/botIpc';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { QueuedInterjections } from './QueuedInterjections';

const store = vi.hoisted(() => ({ queue: [] as BotQueueItem[] }));
vi.mock('@/stores/bots', () => ({
  useBotsStore: (select: (s: typeof store) => unknown) => select(store),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => translate('zh', key, params),
  }),
}));
const render = () =>
  renderToStaticMarkup(
    createElement(QueuedInterjections, {
      chatId: 'g',
      bots: new Map([['b', { name: 'Bob' } as BotProfile]]),
    })
  );
it('offers the button only for a Main-eligible queue item in this chat', () => {
  const item: BotQueueItem = {
    chatId: 'g',
    botId: 'b',
    conversationId: 'c',
    position: 0,
    deliveryId: 'd',
    canInterject: true,
  };
  store.queue = [item];
  expect(render()).toContain('插到 Bob 当前任务');
  expect(render()).toContain('Bob · 排队');
  store.queue = [{ ...item, canInterject: false }];
  expect(render()).not.toContain('<button');
  store.queue = [{ ...item, chatId: 'other' }];
  expect(render()).toBe('');
  store.queue = [];
  expect(render()).toBe('');
});
