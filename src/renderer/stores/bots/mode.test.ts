import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  chats: [{ id: 'g', kind: 'group', activeThreadId: 't' }],
  delegations: [],
  openThread: vi.fn(),
  setView: vi.fn(),
}));
vi.mock('@/stores/bots', () => ({ useBotsStore: { getState: () => state } }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ botModeEnabled: true }) },
}));
vi.mock('@/stores/remoteNodes', () => ({
  useRemoteNodesStore: { getState: () => ({ activeNodeId: 'local' }) },
}));
afterEach(() => vi.unstubAllGlobals());

it('主话题通知即使当前看子话题也打开主话题，不沿用侧栏最近选择', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const { openBotNotification } = await import('./mode');
  await openBotNotification({ kind: 'open', chatId: 'g' });
  expect(state.openThread).toHaveBeenCalledWith('g', 'g');
  expect(state.setView).toHaveBeenCalledWith({ kind: 'chat', chatId: 'g' });
});
