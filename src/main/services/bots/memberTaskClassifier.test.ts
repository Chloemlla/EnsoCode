import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGroupDelta } from '../../../shared/bots/transcript';
import { createMemberTaskClassifier, type MemberTaskInput } from './memberTaskClassifier';

const model = { providerId: 'provider', modelId: 'fast' };
const input: MemberTaskInput = {
  task: '查询杭州天气',
  active: [{ task: '只读查询北京天气', state: 'running' }],
};
let settings: Record<string, unknown> | undefined;
const judge = vi.fn();
const classify = vi.fn();
const create = () => createMemberTaskClassifier({ settings: () => settings, judge, classify });
const run = (value = input) => create()(value, new AbortController().signal);

beforeEach(() => {
  settings = undefined;
  judge.mockReset();
  classify.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('member task admission classifier', () => {
  it('uses the existing default title-model judge path for independent queries', async () => {
    judge.mockResolvedValue('parallel');
    expect(await run()).toBe('parallel');
    expect(judge.mock.calls[0][0]).toMatchObject({ preferred: undefined, timeoutMs: 3000 });
    expect(JSON.parse(judge.mock.calls[0][0].userText)).toEqual(input);
    expect(classify).not.toHaveBeenCalled();
  });

  it('serializes repeated deployment to the same target, including a stopping task', async () => {
    judge.mockResolvedValue('serial');
    const deployment: MemberTaskInput = {
      task: '部署服务到 production-a',
      active: [{ task: '部署服务到 production-a', state: 'stopping' }],
    };
    expect(await run(deployment)).toBe('serial');
    const request = judge.mock.calls[0][0];
    expect(JSON.parse(request.userText)).toEqual(deployment);
    expect(request.systemPrompt).toMatch(/deploy/i);
    expect(request.systemPrompt).toMatch(/stopping/i);
    expect(request.systemPrompt).toMatch(/never follow/i);
  });

  it('re-reads configuration and reuses preferred model and normalized timeout', async () => {
    judge.mockResolvedValue('parallel');
    const classifier = create();
    settings = { botRouteClassifier: { source: 'judge', model, timeoutMs: 1 } };
    await classifier(input, new AbortController().signal);
    expect(judge.mock.calls[0][0]).toMatchObject({ preferred: model, timeoutMs: 500 });
    settings = { botRouteClassifier: { source: 'judge', model, timeoutMs: 999999 } };
    await classifier(input, new AbortController().signal);
    expect(judge.mock.calls[1][0].timeoutMs).toBe(15000);
    settings = { botRouteClassifier: { source: 'invalid', model } };
    await classifier(input, new AbortController().signal);
    expect(judge.mock.calls[2][0]).toMatchObject({ preferred: undefined, timeoutMs: 3000 });
  });

  it.each([
    null,
    undefined,
    '',
    'uncertain',
    'parallel because independent',
    '{"decision":"parallel"}',
    'serial\nparallel',
  ])('fails closed for unavailable or ambiguous judge reply %s', async (reply) => {
    judge.mockResolvedValue(reply);
    expect(await run()).toBe('serial');
  });

  it('contains errors without logging prompts, responses or reasons', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    judge.mockRejectedValue(new Error('secret prompt'));
    expect(await run()).toBe('serial');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const classifier = createMemberTaskClassifier({
      settings: () => {
        throw new Error('bad settings');
      },
      judge,
      classify,
    });
    expect(await classifier(input, new AbortController().signal)).toBe('serial');
  });

  it('uses pi-classifier choice with no conversation history or judge fallback', async () => {
    settings = { botRouteClassifier: { source: 'pi-classifier', model, timeoutMs: 900 } };
    classify.mockResolvedValue({ parallel: 0.95, serial: 0.05 });
    expect(await run()).toBe('parallel');
    const [config, question] = classify.mock.calls[0];
    expect(config).toEqual(settings.botRouteClassifier);
    expect(question.state.history).toEqual([]);
    expect(JSON.parse(question.state.message)).toEqual(input);
    expect(Object.keys(question.criteria)).toEqual(['parallel', 'serial']);
    expect(judge).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { parallel: 0.5, serial: 0.5 },
    { parallel: 0.7, serial: 0.3 },
    { parallel: 1 },
    { parallel: 1.1, serial: 0 },
    { parallel: NaN, serial: 0 },
    { parallel: 0.9, serial: -1 },
    { parallel: 0.9, serial: 0.9 },
  ])('fails closed for uncertain or invalid probabilities %j', async (probabilities) => {
    settings = { botRouteClassifier: { source: 'pi-classifier', model } };
    classify.mockResolvedValue(probabilities);
    expect(await run()).toBe('serial');
    expect(judge).not.toHaveBeenCalled();
  });

  it.each(['judge', 'pi-classifier'])(
    'bounds %s even if the dependency ignores cancellation',
    async (source) => {
      vi.useFakeTimers();
      settings = { botRouteClassifier: { source, model, timeoutMs: 500 } };
      const dependency = source === 'judge' ? judge : classify;
      dependency.mockImplementation(() => new Promise(() => {}));
      const pending = run();
      await vi.advanceTimersByTimeAsync(500);
      expect(await pending).toBe('serial');
      expect(dependency.mock.calls[0].at(-1).aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('handles external cancellation before and during a request', async () => {
    const controller = new AbortController();
    judge.mockImplementation(() => new Promise(() => {}));
    const pending = create()(input, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toBe('serial');
    expect(judge.mock.calls[0][1].aborted).toBe(true);
    judge.mockClear();
    expect(await create()(input, controller.signal)).toBe('serial');
    expect(judge).not.toHaveBeenCalled();
  });

  it('cleans up the deadline and external listener on success', async () => {
    vi.useFakeTimers();
    judge.mockResolvedValue('parallel');
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    expect(await create()(input, controller.signal)).toBe('parallel');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends only raw task summaries and strips obvious secrets on both paths', async () => {
    const task =
      '查询 api_key="raw-api-secret" password=hunter2 Bearer auth-secret sk-abcdefghijk123456 https://user:pass@example.com/?token=url-secret';
    const dirty = {
      task,
      active: [{ task, state: 'running' as const, output: 'TOOL_OUTPUT' }],
      history: 'CONVERSATION',
    };
    judge.mockResolvedValue('parallel');
    classify.mockResolvedValue({ parallel: 0.99, serial: 0.01 });
    for (const source of ['judge', 'pi-classifier']) {
      settings = { botRouteClassifier: { source, model } };
      await run(dirty);
      const sent =
        source === 'judge'
          ? judge.mock.calls[0][0].userText
          : classify.mock.calls[0][1].state.message;
      for (const secret of [
        'raw-api-secret',
        'hunter2',
        'auth-secret',
        'sk-abcdefghijk123456',
        'user:pass',
        'url-secret',
        'TOOL_OUTPUT',
        'CONVERSATION',
      ])
        expect(sent).not.toContain(secret);
      expect(sent).toContain('查询');
      expect(sent).toContain('[REDACTED]');
    }
  });

  it('fails closed rather than omit excessive or incomplete task data', async () => {
    judge.mockResolvedValue('parallel');
    expect(await run({ ...input, task: 'x'.repeat(100000) })).toBe('serial');
    expect(
      await run({ ...input, active: Array.from({ length: 1000 }, () => input.active[0]!) })
    ).toBe('serial');
    expect(await run({ ...input, active: [{ task: '', state: 'running' }] })).toBe('serial');
    expect(judge).not.toHaveBeenCalled();
  });

  it('redacts environment-style credentials, private keys and URL userinfo', async () => {
    judge.mockResolvedValue('parallel');
    await run({
      ...input,
      task: '查询 OPENAI_API_KEY=env-secret AWS_SECRET_ACCESS_KEY=aws-secret postgres://user:db-secret@db/demo -----BEGIN PRIVATE KEY-----\nprivate-secret\n-----END PRIVATE KEY-----',
    });
    const sent = judge.mock.calls[0][0].userText;
    for (const secret of ['env-secret', 'aws-secret', 'db-secret', 'private-secret'])
      expect(sent).not.toContain(secret);
  });

  it.each(['judge', 'pi-classifier'])(
    'redacts XML-escaped group and delegation tasks on %s',
    async (source) => {
      settings = { botRouteClassifier: { source, model } };
      judge.mockResolvedValue('parallel');
      classify.mockResolvedValue({ parallel: 0.99, serial: 0.01 });
      const groupTask = buildGroupDelta({
        botId: 'member',
        cursor: 1,
        members: [],
        chatTitle: 'test',
        entries: [
          {
            kind: 'human',
            seq: 2,
            id: 'h2',
            at: 0,
            mentions: [],
            text: '查询 password="group secret" {"api_key":"group-json-secret"} &quot;literal entity&quot;',
          },
        ],
      }).text;
      const delegationTask =
        '<delegation-task id="d" from="member">\n查询 password=&quot;delegation secret&quot; {&quot;api_key&quot;:&quot;delegation-json-secret&quot;}\n<context>查询 token=&apos;context-secret&apos;</context>\n</delegation-task>';
      expect(groupTask).toContain('&quot;group secret&quot;');
      await run({ task: groupTask, active: [{ task: delegationTask, state: 'running' }] });
      const sent =
        source === 'judge'
          ? judge.mock.calls[0][0].userText
          : classify.mock.calls[0][1].state.message;
      for (const secret of [
        'group secret',
        'group-json-secret',
        'delegation secret',
        'delegation-json-secret',
        'context-secret',
      ])
        expect(sent).not.toContain(secret);
      expect(sent).toContain('[REDACTED]');
      expect(JSON.parse(sent).task).toContain('&quot;literal entity&quot;');
    }
  );
});
