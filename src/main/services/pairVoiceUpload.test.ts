import { encodeVoiceChunks } from '@enso/pair';
import type { SpeechTranscribeResult, VoiceSession } from '@shared/types/speech';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceUploads } from './pairVoiceUpload';

const enc = (values: number[], size: number) => encodeVoiceChunks(new Float32Array(values), size);
const chunk = (requestId: string, index: number, data: string, last?: boolean) => ({
  requestId,
  index,
  data,
  ...(last ? { last: true as const } : {}),
});

interface FakeSession extends VoiceSession {
  pushed: number[][];
  finished: boolean;
  cancelled: boolean;
  emit(text: string, correcting?: boolean): void;
}

function setup(limits: { maxSamples?: number; maxActive?: number; ttlMs?: number } = {}) {
  const sessions: FakeSession[] = [];
  const partials: [string, string, boolean?][] = [];
  const up = new VoiceUploads({
    ...limits,
    open: (onPartial) => {
      const s: FakeSession = {
        pushed: [],
        finished: false,
        cancelled: false,
        emit: onPartial,
        push: (samples) => s.pushed.push(Array.from(samples)),
        finish: async (): Promise<SpeechTranscribeResult> => {
          s.finished = true;
          return { ok: true, text: s.pushed.flat().join(',') };
        },
        cancel: () => {
          s.cancelled = true;
        },
      };
      sessions.push(s);
      return s;
    },
    onPartial: (requestId, text, correcting) =>
      partials.push(correcting ? [requestId, text, true] : [requestId, text]),
  });
  return { up, sessions, partials };
}

describe('手机语音流式上传', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('首块打开会话，逐块 push Float32（Int16/32768），末块后 finish 交付', async () => {
    const { up, sessions } = setup();
    const [a, b] = enc([0.5, -0.5, 0.25], 2);
    expect(up.accept(chunk('r', 0, a))).toBeNull();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pushed).toEqual([[16384 / 32768, -16384 / 32768]]);
    const done = up.accept(chunk('r', 1, b, true));
    expect(done?.kind).toBe('finish');
    if (done?.kind !== 'finish') return;
    expect(done.requestId).toBe('r');
    expect(sessions[0].pushed).toEqual([[0.5, -0.5], [0.25]]);
    await expect(done.result).resolves.toEqual({ ok: true, text: '0.5,-0.5,0.25' });
  });

  it('乱序到达只 push 从 0 连续的块，补齐后按序推进', () => {
    const { up, sessions } = setup();
    const [a, b, c] = enc([0.5, 0.25, -0.5], 1);
    expect(up.accept(chunk('r', 2, c, true))).toBeNull();
    expect(up.accept(chunk('r', 1, b))).toBeNull();
    expect(sessions[0].pushed).toEqual([]);
    expect(up.accept(chunk('r', 0, a))?.kind).toBe('finish');
    expect(sessions[0].pushed).toEqual([[0.5], [0.25], [-0.5]]);
    expect(sessions[0].finished).toBe(true);
  });

  it('中间结果带 requestId 转出；cancel 后的迟到 partial 丢弃', () => {
    const { up, sessions, partials } = setup();
    const [a] = enc([0.1], 1);
    up.accept(chunk('r', 0, a));
    sessions[0].emit('你好');
    expect(partials).toEqual([['r', '你好']]);
    up.cancel('r');
    expect(sessions[0].cancelled).toBe(true);
    sessions[0].emit('迟到');
    expect(partials).toEqual([['r', '你好']]);
  });

  it('收尾纠错期间的中间结果照常转出，结果出来后或连接清理后丢弃', async () => {
    const { up, sessions, partials } = setup();
    const [a] = enc([0.1], 1);
    const done = up.accept(chunk('s', 0, a, true));
    sessions[0].emit('原文', true);
    expect(partials).toEqual([['s', '原文', true]]);
    if (done?.kind === 'finish') await done.result;
    await Promise.resolve();
    sessions[0].emit('完成后');
    up.accept(chunk('t', 0, a, true));
    up.clear();
    sessions[1].emit('断线后', true);
    expect(partials).toEqual([['s', '原文', true]]);
  });

  it('非法数据报 invalid-audio 并取消会话，同 id 后续分块忽略且不占名额', () => {
    const { up, sessions } = setup({ maxActive: 1 });
    const [a] = enc([0.1], 1);
    up.accept(chunk('r', 0, a));
    expect(up.accept(chunk('r', 1, 'AA'))).toEqual({
      kind: 'error',
      requestId: 'r',
      error: 'invalid-audio',
    });
    expect(sessions[0].cancelled).toBe(true);
    expect(up.accept(chunk('r', 2, a, true))).toBeNull();
    expect(up.accept(chunk('s', 0, a, true))?.kind).toBe('finish');
  });

  it('重复 index、越过总数、末块与已有 index 矛盾均报错', () => {
    const [a] = enc([0.1], 1);
    const dup = setup();
    dup.up.accept(chunk('r', 0, a));
    expect(dup.up.accept(chunk('r', 0, a))?.kind).toBe('error');
    expect(dup.sessions[0].cancelled).toBe(true);

    const dupBuffered = setup().up;
    dupBuffered.accept(chunk('r', 2, a));
    expect(dupBuffered.accept(chunk('r', 2, a))?.kind).toBe('error');

    const beyond = setup().up;
    beyond.accept(chunk('r', 1, a, true));
    expect(beyond.accept(chunk('r', 2, a))?.kind).toBe('error');

    const early = setup().up;
    early.accept(chunk('r', 3, a));
    expect(early.accept(chunk('r', 1, a, true))?.kind).toBe('error');

    const twoLast = setup().up;
    twoLast.accept(chunk('r', 2, a, true));
    expect(twoLast.accept(chunk('r', 1, a, true))?.kind).toBe('error');
  });

  it('累计采样超上限报 invalid-audio', () => {
    const { up, sessions } = setup({ maxSamples: 3 });
    const [a, b] = enc([0, 0, 0, 0], 2);
    expect(up.accept(chunk('r', 0, a))).toBeNull();
    expect(up.accept(chunk('r', 1, b, true))).toEqual({
      kind: 'error',
      requestId: 'r',
      error: 'invalid-audio',
    });
    expect(sessions[0].cancelled).toBe(true);
  });

  it('同时进行的会话超过上限报 failed 且不开会话，finish 后释放名额', () => {
    const { up, sessions } = setup();
    const [a] = enc([0.1], 1);
    up.accept(chunk('r1', 0, a));
    up.accept(chunk('r2', 0, a));
    expect(up.accept(chunk('r3', 0, a))).toEqual({
      kind: 'error',
      requestId: 'r3',
      error: 'failed',
    });
    expect(sessions).toHaveLength(2);
    expect(up.accept(chunk('r1', 1, a, true))?.kind).toBe('finish');
    expect(up.accept(chunk('r4', 0, a, true))?.kind).toBe('finish');
  });

  it('结束的 requestId 进 dead 表，迟到分块不再开会话', () => {
    const { up, sessions } = setup();
    const [a] = enc([0.1], 1);
    up.accept(chunk('r', 0, a, true));
    expect(up.accept(chunk('r', 1, a))).toBeNull();
    expect(sessions).toHaveLength(1);
  });

  it('TTL 按最后一次收到分块计算：持续有块不超时，停顿超时则取消并判死', () => {
    const { up, sessions } = setup({ ttlMs: 1000 });
    const [a] = enc([0.1], 1);
    for (let i = 0; i < 5; i++) {
      up.accept(chunk('r', i, a));
      vi.advanceTimersByTime(900);
    }
    expect(sessions[0].cancelled).toBe(false);
    vi.advanceTimersByTime(101);
    expect(sessions[0].cancelled).toBe(true);
    expect(up.accept(chunk('r', 5, a, true))).toBeNull();
    expect(sessions).toHaveLength(1);
  });

  it('finish 之后不再受 TTL 影响', () => {
    const { up, sessions } = setup({ ttlMs: 1000 });
    const [a] = enc([0.1], 1);
    up.accept(chunk('r', 0, a, true));
    vi.advanceTimersByTime(5000);
    expect(sessions[0].cancelled).toBe(false);
  });

  it('cancel 取消会话并判死；未知 id 无副作用', () => {
    const { up, sessions } = setup({ maxActive: 1 });
    const [a] = enc([0.1], 1);
    up.cancel('nope');
    up.accept(chunk('r', 0, a));
    up.cancel('r');
    expect(sessions[0].cancelled).toBe(true);
    expect(up.accept(chunk('r', 1, a, true))).toBeNull();
    expect(up.accept(chunk('s', 0, a, true))?.kind).toBe('finish');
  });

  it('clear 取消所有进行中的会话并释放名额', () => {
    const { up, sessions } = setup({ maxActive: 1 });
    const [a] = enc([0.1], 1);
    up.accept(chunk('r', 0, a));
    up.clear();
    expect(sessions[0].cancelled).toBe(true);
    expect(up.accept(chunk('s', 0, a, true))?.kind).toBe('finish');
  });
});
