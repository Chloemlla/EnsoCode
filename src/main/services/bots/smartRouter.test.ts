import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmartRouteInput } from '../../../shared/bots/smartRoute';
import { createSmartRouter } from './smartRouter';

const input: SmartRouteInput = {
  candidates: [
    { id: 'a', name: 'Alice', title: '', scope: 'lead', canAct: false, owner: true },
    { id: 'b', name: 'Bob', title: '', scope: 'backend', canAct: true, owner: false },
    { id: 'c', name: 'Carol', title: '', scope: 'frontend', canAct: true, owner: false },
  ],
  bossBotId: 'a',
  recent: [],
  message: 'who owns the api',
};
const signal = new AbortController().signal;
const judgeModel = { providerId: 'p', modelId: 'fast' };

let settings: Record<string, unknown> | undefined;
const judge = vi.fn();
const classify = vi.fn();
const router = () => createSmartRouter({ settings: () => settings, judge, classify });

beforeEach(() => {
  settings = {};
  judge.mockReset();
  classify.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('createSmartRouter', () => {
  it('点名「大家 / 都 / everyone」时不问模型，全员按群成员顺序依次回复', async () => {
    for (const message of [
      '都自我介绍一下',
      '大家说说各自的看法',
      '各位报个到',
      'everyone introduce yourselves',
      'Each of you, say hi',
    ])
      expect(await router().select({ ...input, message }, signal)).toEqual({
        ids: ['a', 'b', 'c'],
      });
    expect(judge).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it('「都」不是在点名全员时照常问模型', async () => {
    judge.mockResolvedValue('Bob');
    for (const message of ['这些都改成蓝色', '都几点了接口还挂着', 'all tests failed'])
      expect((await router().select({ ...input, message }, signal)).ids).toEqual(['b']);
    expect(judge).toHaveBeenCalledTimes(3);
  });

  it('未设置时走 judge（标题模型回退链），默认超时 15s、限输出', async () => {
    judge.mockResolvedValueOnce('Bob');
    expect(router().timeoutMs()).toBe(15_000);
    expect(await router().select(input, signal)).toEqual({ ids: ['b'], intent: 'answer' });
    expect(judge.mock.calls[0][0]).toMatchObject({
      preferred: undefined,
      timeoutMs: 15_000,
      maxTokens: 128,
    });
    expect(judge.mock.calls[0][0].userText).toContain('who owns the api');
    expect(classify).not.toHaveBeenCalled();
  });

  it('指定 judge 模型时排在最前；旧版存下的 3000ms 抬到 15s，其他自定义值照用', async () => {
    settings = { botRouteClassifier: { source: 'judge', model: judgeModel, timeoutMs: 3000 } };
    judge.mockResolvedValueOnce('BOSS');
    expect(router().timeoutMs()).toBe(15_000);
    expect((await router().select(input, signal)).ids).toEqual(['a']);
    expect(judge.mock.calls[0][0]).toMatchObject({ preferred: judgeModel, timeoutMs: 15_000 });
    settings = { botRouteClassifier: { source: 'judge', model: judgeModel, timeoutMs: 12_000 } };
    expect(router().timeoutMs()).toBe(12_000);
  });

  it('judge 回复多名时按顺序返回名单', async () => {
    judge.mockResolvedValueOnce('INTENT: discuss\nCarol\nBob');
    expect(await router().select(input, signal)).toEqual({ ids: ['c', 'b'], intent: 'discuss' });
  });

  it('judge 判定 build 时只留一位能动手的成员；缺 INTENT 行按关键词兜底', async () => {
    judge.mockResolvedValueOnce('INTENT: build\nAlice\nCarol\nBob');
    expect(await router().select(input, signal)).toEqual({ ids: ['c'], intent: 'build' });
    judge.mockResolvedValueOnce('Alice, Bob');
    expect(await router().select({ ...input, message: '把 README 标题改成 X' }, signal)).toEqual({
      ids: ['b'],
      intent: 'build',
    });
  });

  it('judge 回复不认识时返回空名单；没有可用模型时带失败原因', async () => {
    judge.mockResolvedValueOnce('maybe Dave');
    expect((await router().select(input, signal)).ids).toEqual([]);
    judge.mockResolvedValueOnce(null);
    const failed = await router().select(input, signal);
    expect(failed.ids).toEqual([]);
    expect(failed.failure).toBeTruthy();
  });

  it('judge 抛错时透出归类原因', async () => {
    judge.mockRejectedValueOnce(new Error('模型 gpt-5：鉴权失败'));
    const failed = await router().select(input, signal);
    expect(failed).toEqual({ ids: [], failure: '模型 gpt-5：鉴权失败' });
  });

  it('pi-classifier 取达到 0.4 的候选（降序），都不达标或不可用时返回空名单', async () => {
    settings = {
      botRouteClassifier: {
        source: 'pi-classifier',
        model: { providerId: 'or', modelId: 'cls' },
        timeoutMs: 3000,
      },
    };
    classify.mockResolvedValueOnce({ a: 0.3, b: 0.7 });
    expect((await router().select(input, signal)).ids).toEqual(['b']);
    const [config, question] = classify.mock.calls[0];
    expect(config).toMatchObject({
      source: 'pi-classifier',
      model: { modelId: 'cls' },
      timeoutMs: 15_000,
    });
    expect(classify.mock.calls[1][0].timeoutMs).toBe(15_000);
    expect(Object.keys(question.criteria)).toEqual(['a', 'b', 'c']);
    classify.mockResolvedValueOnce({ a: 0.1, b: 0.42, c: 0.48 }).mockResolvedValueOnce(null);
    expect((await router().select(input, signal)).ids).toEqual(['c', 'b']);
    classify.mockResolvedValueOnce({ a: 0.35, b: 0.3, c: 0.35 }).mockResolvedValueOnce(null);
    expect((await router().select(input, signal)).ids).toEqual([]);
    classify.mockResolvedValueOnce(null);
    expect((await router().select(input, signal)).failure).toBeTruthy();
    expect(judge).not.toHaveBeenCalled();
  });

  it('pi-classifier 抛错时透出原因给群里', async () => {
    settings = {
      botRouteClassifier: {
        source: 'pi-classifier',
        model: { providerId: 'or', modelId: 'cls' },
        timeoutMs: 3000,
      },
    };
    classify.mockRejectedValueOnce(new Error('模型 cls：网络连接失败')).mockResolvedValueOnce(null);
    const failed = await router().select(input, signal);
    expect(failed).toEqual({ ids: [], failure: '模型 cls：网络连接失败' });
  });

  it('pi-classifier 另问意图；build 按概率取第一位能动手的成员，意图不确定时用关键词', async () => {
    settings = {
      botRouteClassifier: {
        source: 'pi-classifier',
        model: { providerId: 'or', modelId: 'cls' },
        timeoutMs: 3000,
      },
    };
    classify.mockImplementation(async (_config, question) =>
      'build' in question.criteria
        ? { build: 0.8, answer: 0.1, discuss: 0.1 }
        : { a: 0.6, b: 0.1, c: 0.3 }
    );
    expect(await router().select(input, signal)).toEqual({ ids: ['c'], intent: 'build' });
    classify.mockImplementation(async (_config, question) =>
      'build' in question.criteria
        ? { build: 0.4, answer: 0.3, discuss: 0.3 }
        : { a: 0.5, b: 0.45, c: 0.05 }
    );
    expect(await router().select(input, signal)).toEqual({ ids: ['a', 'b'], intent: 'answer' });
    expect(await router().select({ ...input, message: 'please fix the api' }, signal)).toEqual({
      ids: ['b'],
      intent: 'build',
    });
  });
});
