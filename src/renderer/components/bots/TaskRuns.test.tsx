import { translate } from '@shared/i18n';
import type { BotProfile, Delegation, GroupTaskRun } from '@shared/types/bot';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRunAppends, TaskRuns } from './TaskRuns';

const store = vi.hoisted(() => ({
  delegations: [] as Delegation[],
  locale: 'zh' as 'zh' | 'en',
}));
vi.mock('@/stores/bots', () => ({
  useBotsStore: (select: (state: unknown) => unknown) =>
    select({ delegations: store.delegations, sessions: {}, queue: [] }),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      translate(store.locale, key, params),
  }),
}));

const NOW = Date.now();
const MIN = 60_000;
const bots = new Map([
  ['a', { id: 'a', name: 'Alice', avatar: { color: '#888' } } as BotProfile],
  ['b', { id: 'b', name: 'Bob', avatar: { color: '#888' } } as BotProfile],
]);
const run = (id: string, extra: Partial<GroupTaskRun>): GroupTaskRun => ({
  id,
  botId: 'a',
  trigger: 'delegate',
  state: 'completed',
  createdAt: NOW - 60 * MIN,
  ...extra,
});
const record = (id: string): Delegation =>
  ({ id, parentBotId: 'b', targetBotId: 'a', childConversationId: `conv-${id}` }) as Delegation;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (runs: GroupTaskRun[]) =>
  text(renderToStaticMarkup(createElement(TaskRuns, { runs, bots, onOpenConversation: () => {} })));

describe('TaskRuns', () => {
  beforeEach(() => {
    store.delegations = [];
    store.locale = 'zh';
  });

  it('按发起先后渲染排队、执行中、交付、失败与转派', () => {
    const html = render([
      run('done', {
        createdAt: NOW - 50 * MIN,
        startedAt: NOW - 50 * MIN,
        finishedAt: NOW - 45 * MIN,
      }),
      run('queued', { state: 'queued', botId: 'b', createdAt: NOW - 3 * MIN }),
      run('nested', {
        state: 'running',
        botId: 'b',
        nested: true,
        createdAt: NOW - 20 * MIN,
        startedAt: NOW - 10 * MIN,
      }),
      run('failed', {
        state: 'failed',
        trigger: 'retry',
        failure: 'timeout',
        createdAt: NOW - 40 * MIN,
        startedAt: NOW - 40 * MIN,
        finishedAt: NOW - 38 * MIN,
      }),
    ]);
    expect(html).toContain('历次执行 · 4');
    const order = [
      'Alice · 派活 已完成 5m',
      'Alice · 重试 失败 2m',
      'Bob · 转派 进行中 10m',
      'Bob · 派活 排队 3m',
    ];
    for (const line of order) expect(html).toContain(line);
    expect(order.map((line) => html.indexOf(line))).toEqual(
      [...order.map((line) => html.indexOf(line))].sort((a, b) => a - b)
    );
    expect(html).toContain('超过 240 分钟未完成，已超时。');
  });

  it('有委派记录才给查看过程；英文文案', () => {
    store.locale = 'en';
    store.delegations = [record('done')];
    const html = renderToStaticMarkup(
      createElement(TaskRuns, {
        runs: [
          run('done', { finishedAt: NOW }),
          run('gone', { state: 'canceled', finishedAt: NOW }),
        ],
        bots,
        onOpenConversation: () => {},
      })
    );
    expect(text(html)).toContain('Run history · 2');
    expect(text(html)).toContain('Alice · Delegated');
    expect(html.match(/View process/g)).toHaveLength(1);
  });

  it('超过 5 次只显示最近 5 次', () => {
    const html = render(
      [1, 2, 3, 4, 5, 6].map((n) => run(`r${n}`, { createdAt: n, finishedAt: n }))
    );
    expect(html).toContain('历次执行 · 6');
    expect(html).toContain('显示全部（6）');
    expect(html.match(/派活/g)).toHaveLength(5);
  });

  it('有追加的执行行显示「+N 追加」，可展开', () => {
    store.delegations = [record('done')];
    const html = renderToStaticMarkup(
      createElement(TaskRuns, {
        runs: [
          run('done', { state: 'running', startedAt: NOW - MIN, appends: 2 }),
          run('plain', {}),
        ],
        bots,
        onOpenConversation: () => {},
      })
    );
    expect(html.match(/\+2 追加/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false"');
    store.locale = 'en';
    expect(
      renderToStaticMarkup(
        createElement(TaskRuns, {
          runs: [run('done', { appends: 1 })],
          bots,
          onOpenConversation: () => {},
        })
      )
    ).toContain('+1 appended');
  });

  it('展开后列出每条追加的时间、摘要与是否送达', () => {
    const at = new Date(2026, 9, 13, 9, 5).getTime();
    const appends = [
      { at, text: '顺便加个重连按钮\n细节', deliveryId: 'x1', ok: true },
      { at, text: '文案改成网络已断开', deliveryId: 'x2', ok: false },
      { at, text: '再补一条单测', deliveryId: 'x3' },
    ];
    const html = text(renderToStaticMarkup(createElement(TaskRunAppends, { appends })));
    expect(html).toContain('顺便加个重连按钮');
    expect(html).toContain('已送达');
    expect(html).toContain('未送达');
    expect(html).toContain('处理中');
    expect(html).toContain(
      new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
    store.locale = 'en';
    const en = text(renderToStaticMarkup(createElement(TaskRunAppends, { appends })));
    for (const label of ['Delivered', 'Not delivered', 'Processing']) expect(en).toContain(label);
  });
});
