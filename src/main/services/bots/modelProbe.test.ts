import { describe, expect, it, vi } from 'vitest';
import type { DefaultModelRef } from '../../../shared/defaultModel';
import type { SpawnModelConfig } from '../../../shared/types/agent';
import { briefErrorReason, createModelProbe, describeModelIssue } from './modelProbe';

const ENGINE: DefaultModelRef = { providerId: 'openai', modelId: 'gpt-5' };
const DEFAULT: DefaultModelRef = { providerId: 'anthropic', modelId: 'claude' };

const config = (modelId: string, extra: Record<string, unknown> = {}): SpawnModelConfig =>
  ({
    api: 'openai-completions',
    baseUrl: 'https://api.example.com',
    apiKey: 'k',
    modelId,
    settingsProviderId: 'openai',
    ...extra,
  }) as SpawnModelConfig;

function fixture(overrides: {
  state?: Record<string, unknown>;
  resolveOk?: boolean;
  resolveError?: string;
  workerReady?: boolean;
  completeError?: string;
}) {
  const state = overrides.state ?? { defaultModel: DEFAULT };
  const resolve = vi.fn((ref: DefaultModelRef) =>
    (overrides.resolveOk ?? true)
      ? { ok: true as const, config: config(ref.modelId) }
      : {
          ok: false as const,
          error: overrides.resolveError ?? 'Model is unavailable: model-missing',
        }
  );
  const complete = vi.fn(
    async (_request: {
      systemPrompt: string;
      userText: string;
      candidates: SpawnModelConfig[];
      timeoutMs: number;
      maxTokens: number;
    }): Promise<string> =>
      overrides.completeError ? Promise.reject(new Error(overrides.completeError)) : 'OK'
  );
  const probe = createModelProbe({
    settings: () => state,
    credentials: async () => new Set<string>(),
    resolve,
    isWorkerReady: () => overrides.workerReady ?? true,
    complete,
  });
  return { probe, resolve, complete };
}

describe('createModelProbe', () => {
  it('未配置成员模型时回落默认，默认也不可用报默认模型原因', async () => {
    const { probe } = fixture({ resolveOk: false });
    const result = await probe(undefined);
    expect(result).toEqual({ ok: false, error: '模型 claude：模型不存在' });
  });

  it('成员与默认都没配置时报未配置可用模型', async () => {
    const { probe } = fixture({ state: {} });
    expect(await probe(undefined)).toEqual({ ok: false, error: '未配置可用模型' });
  });

  it('成员配置不可用时报成员所选模型与原因，不回落默认', async () => {
    const { probe } = fixture({
      resolveOk: false,
      resolveError: 'Model is unavailable: api-key-missing',
    });
    const result = await probe(ENGINE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('gpt-5');
    expect(result.error).toContain('缺少 API Key');
  });

  it('模型配置存在但实测失败时报告模型与归类原因（鉴权）', async () => {
    const { probe } = fixture({ completeError: '401 Unauthorized: invalid api key' });
    const result = await probe(ENGINE);
    expect(result).toEqual({ ok: false, error: '模型 gpt-5：鉴权失败' });
  });

  it('实测失败：网络错误归类', async () => {
    const { probe } = fixture({ completeError: 'fetch failed: connect ECONNREFUSED 127.0.0.1' });
    const result = await probe(ENGINE);
    expect(result).toEqual({ ok: false, error: '模型 gpt-5：网络连接失败' });
  });

  it('实测失败：超时与限流归类', async () => {
    const { probe } = fixture({ completeError: 'completion timed out' });
    expect(await probe(ENGINE)).toEqual({ ok: false, error: '模型 gpt-5：调用超时' });
    const rate = fixture({ completeError: 'HTTP 429 too many requests' });
    expect(await rate.probe(ENGINE)).toEqual({ ok: false, error: '模型 gpt-5：请求被限流' });
  });

  it('worker 未就绪时会话服务未启动', async () => {
    const { probe } = fixture({ workerReady: false });
    expect(await probe(ENGINE)).toEqual({ ok: false, error: '会话服务未启动' });
  });

  it('无成员模型时实测默认模型并沿用默认失败原因', async () => {
    const { probe, complete } = fixture({ completeError: 'HTTP 404 model not found' });
    const result = await probe(undefined);
    expect(result).toEqual({ ok: false, error: '模型 claude：模型不存在' });
    expect(complete.mock.calls[0]?.[0]?.candidates[0]?.modelId).toBe('claude');
  });

  it('同一模型配置实测通过后缓存；配置变化重新实测', async () => {
    const { probe, complete } = fixture({});
    expect(await probe(ENGINE)).toEqual({ ok: true });
    expect(await probe(ENGINE)).toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await probe({ ...ENGINE, modelId: 'gpt-6' })).toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('失败不缓存：修复后下次投递重新实测', async () => {
    const fx = fixture({ completeError: '401 Unauthorized' });
    expect((await fx.probe(ENGINE)).ok).toBe(false);
    fx.complete.mockResolvedValue('OK');
    expect(await fx.probe(ENGINE)).toEqual({ ok: true });
    expect(fx.complete).toHaveBeenCalledTimes(2);
  });
});

describe('describeModelIssue', () => {
  const providers = [
    {
      id: 'openai',
      name: 'OpenAI',
      api: 'openai-completions',
      apiKey: '',
      baseUrl: 'https://x',
      enabled: true,
      models: [{ id: 'gpt-5', name: 'GPT-5' }],
    },
  ];
  const state = { providers };

  it('缺 key / 停用 / 不存在各有可读原因', () => {
    expect(describeModelIssue(state, ENGINE)).toBe('模型 gpt-5 (OpenAI) 不可用：缺少 API Key');
    const disabled = { providers: [{ ...providers[0], enabled: false }] };
    expect(describeModelIssue(disabled, ENGINE)).toContain('供应商已停用');
    const missing = { providers: [{ ...providers[0], models: [] }] };
    expect(describeModelIssue(missing, ENGINE)).toContain('模型不存在');
  });

  it('供应商找不到时仍带模型 id', () => {
    expect(describeModelIssue(state, { providerId: 'ghost', modelId: 'm1' })).toContain('m1');
    expect(describeModelIssue(state, { providerId: 'ghost', modelId: 'm1' })).toContain(
      '找不到供应商'
    );
  });
});

describe('briefErrorReason', () => {
  it('已知形态归类，未知错误截断', () => {
    expect(briefErrorReason(new Error('401 Unauthorized'))).toBe('鉴权失败');
    expect(briefErrorReason(new Error('connect ETIMEDOUT'))).toBe('网络连接失败');
    expect(briefErrorReason(new Error('p/m: Connection error.'))).toBe('网络连接失败');
    expect(briefErrorReason(new Error('aborted'))).toBe('已取消');
    const long = `x${'y'.repeat(200)}`;
    expect(briefErrorReason(new Error(long))).toHaveLength(81);
    expect(briefErrorReason('模型 gpt-5：鉴权失败')).toBe('模型 gpt-5：鉴权失败');
  });
});
