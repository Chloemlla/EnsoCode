import type { Api, Message, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  createVirtualChooser,
  latestUserText,
  nextTier,
  parseJudgeReply,
} from './virtualClassifier';
import type { VirtualMembers } from './virtualModels';

const model = (id: string) => ({ id, provider: 'p', input: ['text'] }) as unknown as Model<Api>;
const members: VirtualMembers = { primary: model('strong'), fast: model('weak'), fallbacks: [] };
const user = (text: string) =>
  ({ role: 'user', content: [{ type: 'text', text }], timestamp: 0 }) as Message;
const request = (state?: object, messages: Message[] = [user('fix the bug')]) =>
  ({ model: model('auto'), thinkingLevel: 'high', reason: 'user', messages, state }) as never;
const runtime = {} as ModelRuntime;

describe('virtualClassifier', () => {
  it('滞回：升档立即生效，降档要连续两轮 simple', () => {
    expect(nextTier('complex', { tier: 'simple', simpleStreak: 3 })).toEqual({
      tier: 'complex',
      simpleStreak: 0,
    });
    expect(nextTier('simple', { tier: 'complex', simpleStreak: 0 })).toEqual({
      tier: 'complex',
      simpleStreak: 1,
    });
    expect(nextTier('simple', { tier: 'complex', simpleStreak: 1 })).toEqual({
      tier: 'simple',
      simpleStreak: 2,
    });
    expect(nextTier('simple', undefined)).toEqual({ tier: 'simple', simpleStreak: 1 });
  });

  it('解析裁判回复与本轮用户文本', () => {
    expect(parseJudgeReply(' complex.')).toBe('complex');
    expect(parseJudgeReply('SIMPLE')).toBe('simple');
    expect(parseJudgeReply('maybe')).toBeUndefined();
    expect(latestUserText([user('first'), user('  second  ')])).toBe('second');
    expect(latestUserText([user('x'.repeat(5000))])).toHaveLength(4000);
  });

  it('simple 选快模型、complex 选主模型并写回档位；无快模型或无输入时不分类', async () => {
    const simple = createVirtualChooser(
      runtime,
      { source: 'judge', timeoutMs: 1000 },
      undefined,
      async () => 'simple'
    )!;
    await expect(simple(request(), members)).resolves.toEqual({
      preferred: members.fast,
      state: { tier: 'simple', simpleStreak: 1 },
    });
    const complex = createVirtualChooser(
      runtime,
      { source: 'judge', timeoutMs: 1000 },
      undefined,
      async () => 'complex'
    )!;
    await expect(complex(request(), members)).resolves.toMatchObject({
      preferred: members.primary,
    });
    await expect(simple(request(), { ...members, fast: undefined })).resolves.toBeUndefined();
    await expect(simple(request(undefined, []), members)).resolves.toBeUndefined();
  });

  it('超时以 abort 信号传给分类调用', async () => {
    let aborted = false;
    const chooser = createVirtualChooser(
      runtime,
      { source: 'judge', timeoutMs: 20 },
      undefined,
      (_input, _previous, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        })
    )!;
    await expect(chooser(request(), members)).rejects.toThrow('aborted');
    expect(aborted).toBe(true);
  });

  it('judge 来源缺裁判模型时不创建分类器', () => {
    expect(createVirtualChooser(runtime, { source: 'judge', timeoutMs: 1000 }, undefined)).toBe(
      undefined
    );
  });
});
