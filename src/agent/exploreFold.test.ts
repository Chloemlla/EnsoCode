import { describe, expect, it } from 'vitest';
import {
  createExploreFoldState,
  createExploreFoldTools,
  exploreFoldContextEdits,
  exploreFoldExtension,
  foldExploreContext,
  type LlmMessage,
} from './exploreFold';

const user = (text: string): LlmMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
});
const calls = (...parts: Array<[string, string, Record<string, unknown>?]>): LlmMessage => ({
  role: 'assistant',
  content: parts.map(([id, name, args]) => ({ type: 'toolCall', id, name, arguments: args ?? {} })),
});
const call = (id: string, name: string, args?: Record<string, unknown>) => calls([id, name, args]);
const result = (toolCallId: string, extra: Partial<LlmMessage> = {}): LlmMessage => ({
  role: 'toolResult',
  toolCallId,
  content: [{ type: 'text', text: 'ok' }],
  isError: false,
  ...extra,
});
const reply = (text: string): LlmMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
});

describe('foldExploreContext', () => {
  it('删除 mark 与 fold 之间的工具轮次，保留 mark/fold 调用及其结果', () => {
    const messages = [
      user('look around'),
      call('m1', 'explore_mark', { goal: 'g' }),
      result('m1'),
      call('r1', 'read', { path: 'a.ts' }),
      result('r1'),
      call('f1', 'explore_fold', { report: 'auth is in src/auth.ts' }),
      result('f1'),
      reply('now implement'),
    ];
    const folded = foldExploreContext(messages);
    expect(folded).toEqual([0, 1, 2, 5, 6, 7].map((i) => messages[i]));
  });

  it('区间内的 system 消息（工具/提示增量）保留', () => {
    const system: LlmMessage = { role: 'system', content: '' };
    const messages = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1'),
      call('r1', 'read'),
      result('r1'),
      system,
      call('f1', 'explore_fold'),
      result('f1'),
    ];
    expect(foldExploreContext(messages)).toEqual([0, 1, 2, 5, 6, 7].map((i) => messages[i]));
  });

  it('mark / fold 与其它工具并行调用时，同批调用与结果都保留', () => {
    const messages = [
      user('go'),
      calls(['m1', 'explore_mark'], ['r0', 'read']),
      result('m1'),
      result('r0'),
      call('r1', 'read'),
      result('r1'),
      calls(['r2', 'read'], ['f1', 'explore_fold']),
      result('r2'),
      result('f1'),
    ];
    expect(foldExploreContext(messages)).toEqual([0, 1, 2, 3, 6, 7, 8].map((i) => messages[i]));
  });

  it('mark 后直接 fold、或二者同批调用时不变', () => {
    const adjacent = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1'),
      call('f1', 'explore_fold'),
      result('f1'),
    ];
    expect(foldExploreContext(adjacent)).toBe(adjacent);
    const sameMessage = [
      user('go'),
      calls(['m1', 'explore_mark'], ['f1', 'explore_fold']),
      result('m1'),
      result('f1'),
    ];
    expect(foldExploreContext(sameMessage)).toBe(sameMessage);
  });

  it('fold 失败、尚无结果或 mark 失败时不折叠', () => {
    const body = [call('r1', 'read'), result('r1')];
    const failedFold = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1'),
      ...body,
      call('f1', 'explore_fold'),
      result('f1', { isError: true }),
    ];
    expect(foldExploreContext(failedFold)).toBe(failedFold);
    const pendingFold = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1'),
      ...body,
      call('f1', 'explore_fold'),
    ];
    expect(foldExploreContext(pendingFold)).toBe(pendingFold);
    const failedMark = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1', { isError: true }),
      ...body,
      call('f1', 'explore_fold'),
      result('f1'),
    ];
    expect(foldExploreContext(failedMark)).toBe(failedMark);
  });

  it('区间跨过用户消息时不折叠，避免吞掉用户输入', () => {
    const messages = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1'),
      reply('forgot to fold'),
      user('continue'),
      call('f1', 'explore_fold'),
      result('f1'),
    ];
    expect(foldExploreContext(messages)).toBe(messages);
  });

  it('多段 mark→fold 各自折叠', () => {
    const messages = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1'),
      call('r1', 'read'),
      result('r1'),
      call('f1', 'explore_fold'),
      result('f1'),
      call('m2', 'explore_mark'),
      result('m2'),
      call('r2', 'read'),
      result('r2'),
      call('f2', 'explore_fold'),
      result('f2'),
    ];
    expect(foldExploreContext(messages)).toEqual(
      [0, 1, 2, 5, 6, 7, 8, 11, 12].map((i) => messages[i])
    );
  });
});

const entries = (messages: LlmMessage[]) =>
  messages.map((message, i) => ({
    sourceEntry: { id: `e${i}`, type: 'message' },
    messages: [message],
  }));

describe('exploreFoldContextEdits', () => {
  it('返回 mark 与 fold 之间整条被折叠的消息条目 id', () => {
    const messages = [
      user('look around'),
      call('m1', 'explore_mark'),
      result('m1'),
      call('r1', 'read'),
      result('r1'),
      call('f1', 'explore_fold'),
      result('f1'),
    ];
    expect(exploreFoldContextEdits(entries(messages))).toEqual(['e3', 'e4']);
  });

  it('已被编辑掉（无投影消息）或非 message 条目不再产出编辑', () => {
    const messages = [
      user('go'),
      call('m1', 'explore_mark'),
      result('m1'),
      call('r1', 'read'),
      result('r1'),
      call('f1', 'explore_fold'),
      result('f1'),
    ];
    const projected = entries(messages);
    projected[3] = { sourceEntry: { id: 'e3', type: 'message' }, messages: [] };
    projected[4] = { sourceEntry: { id: 'e4', type: 'custom_message' }, messages: [messages[4]] };
    expect(exploreFoldContextEdits(projected)).toEqual([]);
  });

  it('没有完成的折叠时为空', () => {
    const messages = [user('go'), call('m1', 'explore_mark'), result('m1'), call('r1', 'read')];
    expect(exploreFoldContextEdits(entries(messages))).toEqual([]);
  });
});

describe('exploreFoldExtension', () => {
  type Handler = (event: unknown, ctx: unknown) => unknown;
  const install = () => {
    const handlers = new Map<string, Handler>();
    const extension = exploreFoldExtension(createExploreFoldState()) as {
      factory: (pi: never) => void;
    };
    extension.factory({
      on: (name: string, handler: Handler) => handlers.set(name, handler),
    } as never);
    return handlers;
  };
  const messages = [
    user('go'),
    call('m1', 'explore_mark'),
    result('m1'),
    call('r1', 'read'),
    result('r1'),
    call('f1', 'explore_fold'),
    result('f1'),
  ];
  const turnEnd = (message: LlmMessage, toolResults: LlmMessage[]) => ({
    type: 'turn_end',
    outcome: 'completed',
    message,
    toolResults,
    entries: [{ type: 'custom', customType: 'other' }],
    context: { contextEntries: entries(messages) },
  });

  it('fold 成功的轮次结束时把折叠区间写成持久 context_edit，并保留已有草稿', () => {
    const handler = install().get('turn_end');
    expect(handler?.(turnEnd(messages[5], [messages[6]]), {})).toEqual({
      entries: [
        { type: 'custom', customType: 'other' },
        { type: 'context_edit', targetId: 'e3', replacement: null },
        { type: 'context_edit', targetId: 'e4', replacement: null },
      ],
    });
  });

  it('本轮没有成功 fold 时不扫描也不产出编辑', () => {
    const handler = install().get('turn_end');
    expect(handler?.(turnEnd(messages[3], [messages[4]]), {})).toBeUndefined();
    expect(handler?.(turnEnd(messages[5], [result('f1', { isError: true })]), {})).toBeUndefined();
  });

  it('旧会话仍由 context 钩子兜底折叠', () => {
    const handler = install().get('context');
    expect(handler?.({ messages }, {})).toEqual({
      messages: [0, 1, 2, 5, 6].map((i) => messages[i]),
    });
  });
});

describe('createExploreFoldState', () => {
  it('rejects fold without mark and double mark', () => {
    const state = createExploreFoldState();
    expect(() => state.fold('x')).toThrow(/no active explore_mark/i);
    state.mark('goal');
    expect(() => state.mark('again')).toThrow(/already active/i);
    expect(state.fold(' report ')).toBe('report');
  });
});

describe('createExploreFoldTools', () => {
  it('explore_fold 的结果正文里带上 report,时间线展开即可看到留存内容', async () => {
    const state = createExploreFoldState();
    const tools = createExploreFoldTools(state);
    const fold = tools.find((tool) => tool.name === 'explore_fold');
    expect(fold).toBeDefined();
    state.mark('goal');
    const result = await fold?.execute(
      'id',
      { report: '  auth 在 src/auth.ts  ' },
      undefined,
      undefined,
      {} as never
    );
    const text = result?.content.map((part) => ('text' in part ? part.text : '')).join('');
    expect(text).toContain('auth 在 src/auth.ts');
    expect(text).toContain('Explore folded.');
  });
});
