import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ChatScreen } from './ChatScreen';

vi.mock('./stubs/sessions-store', () => ({ setDisplayedConversation: () => {} }));
vi.mock('./chatHost', () => ({ phoneChatHost: () => ({}) }));
vi.mock('@/components/chat/Composer', () => ({
  Composer: ({ focusKey }: { focusKey: string }) =>
    createElement('div', { 'data-draft-key': focusKey }),
}));
vi.mock('@/components/chat/MessageTimeline', () => ({ MessageTimeline: () => null, CHAT_COL: '' }));
vi.mock('@/components/chat/ApprovalBar', () => ({ ApprovalBar: () => null }));
vi.mock('@/components/chat/AskBar', () => ({ AskBar: () => null }));
vi.mock('@/components/chat/GoalBar', () => ({ GoalBar: () => null }));
vi.mock('@/components/chat/TaskBar', () => ({ TaskBar: () => null }));
vi.mock('@/components/chat/TodoBar', () => ({ TodoBar: () => null }));
vi.mock('@/components/chat/RetryBar', () => ({ RetryBar: () => null }));
vi.mock('@/components/chat/MessageQueue', () => ({ MessageQueue: () => null }));
vi.mock('./SessionStatsLine', () => ({ SessionStatsLine: () => null }));

const noop = () => {};
const render = (patch: Partial<Parameters<typeof ChatScreen>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ChatScreen, {
      sessionId: 'direct',
      title: 'Bot',
      projectName: '',
      view: null,
      connState: 'online',
      stateLabel: 'online',
      canCreate: true,
      onOpenDrawer: noop,
      onNewSession: noop,
      onSend: noop,
      onAbort: noop,
      onApproval: noop,
      onAsk: noop,
      bot: {},
      ...patch,
    })
  );

it('offers new-session in direct Bot and Code, but not the read-only group process', () => {
  expect(render()).toContain('aria-label="新建会话"');
  expect(render({ bot: undefined })).toContain('aria-label="新建会话"');
  expect(render({ bot: { readOnly: true } })).not.toContain('aria-label="新建会话"');
});

it('retains a direct Bot draft across session replacement, without merging Code drafts', () => {
  for (const sessionId of ['old', 'new']) {
    expect(render({ sessionId, bot: { chatId: 'chat' } })).toContain(
      'data-draft-key="bot-chat:chat"'
    );
    expect(render({ sessionId, bot: undefined })).toContain(`data-draft-key="${sessionId}"`);
  }
});

it.each([{ canCreate: false }, { deviceReadOnly: true }, { connState: 'offline' as const }])(
  'disables direct new-session when unavailable: %j',
  (patch) => {
    expect(render(patch).match(/<button[^>]*aria-label="新建会话"[^>]*>/)?.[0]).toContain(
      'disabled=""'
    );
  }
);
