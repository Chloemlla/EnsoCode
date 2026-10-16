import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const catalog: Array<{
    id: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
  }> = [];
  return {
    catalog,
    getModels: vi.fn(() => catalog),
    getAuth: vi.fn(async () => ({ auth: { apiKey: 'xai-token' } })),
    ensureProviderModelsRefreshed: vi.fn<() => Promise<void>>(),
  };
});

vi.mock('./oauthProviders', () => ({
  getRuntime: vi.fn(async () => ({
    getModels: state.getModels,
    getAuth: state.getAuth,
  })),
  ensureProviderModelsRefreshed: state.ensureProviderModelsRefreshed,
  hasStoredAccount: vi.fn(async () => true),
}));

const fetchXai = vi.hoisted(() => vi.fn(async () => [] as Array<{ id: string }>));

vi.mock('./xaiModels', () => ({
  fetchXaiSubscriptionModels: fetchXai,
}));

import { queryModelMeta } from './modelMeta';

describe('queryModelMeta extension catalog refresh', () => {
  beforeEach(() => {
    state.catalog.splice(0);
    state.getModels.mockClear();
    state.getAuth.mockClear();
    state.ensureProviderModelsRefreshed.mockReset();
    fetchXai.mockReset();
    fetchXai.mockResolvedValue([]);
  });

  it('waits for the first online refresh before reading a subscription catalog', async () => {
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    state.ensureProviderModelsRefreshed.mockImplementation(async () => {
      await refreshGate;
      state.catalog.push({
        id: 'cursor-live-model',
        contextWindow: 200_000,
        maxTokens: 32_000,
        reasoning: true,
      });
    });

    const pending = queryModelMeta({
      oauthAccountKey: 'cursor',
      modelIds: ['cursor-live-model'],
    });
    await Promise.resolve();

    expect(state.getModels).not.toHaveBeenCalled();
    releaseRefresh?.();
    await expect(pending).resolves.toMatchObject({
      ok: true,
      models: [
        {
          modelId: 'cursor-live-model',
          contextWindow: 200_000,
          maxTokens: 32_000,
          source: 'catalog',
        },
      ],
    });
    expect(state.ensureProviderModelsRefreshed).toHaveBeenCalledWith(expect.anything(), 'cursor', {
      force: false,
    });
  });

  it('全量拉取订阅清单时强制联网刷新扩展 catalog', async () => {
    state.ensureProviderModelsRefreshed.mockResolvedValue(undefined);
    await queryModelMeta({ oauthAccountKey: 'cursor', modelIds: [] });
    expect(state.ensureProviderModelsRefreshed).toHaveBeenCalledWith(expect.anything(), 'cursor', {
      force: true,
    });
  });

  it('xAI 拉取空清单时打上游，把新 id 并进 catalog', async () => {
    state.catalog.push({
      id: 'grok-4.6',
      contextWindow: 500_000,
      maxTokens: 500_000,
      reasoning: true,
    });
    fetchXai.mockResolvedValue([{ id: 'grok-4.7' }, { id: 'grok-build-0.1' }]);

    const result = await queryModelMeta({ oauthAccountKey: 'xai', modelIds: [] });
    expect(fetchXai).toHaveBeenCalledWith('xai-token');
    expect(result.ok).toBe(true);
    expect(result.models.map((model) => model.modelId)).toEqual([
      'grok-4.6',
      'grok-4.7',
      'grok-build-0.1',
    ]);
  });

  it('xAI 上游失败时仍返回 overlay 的 grok-4.7，指定 id 查询不打上游', async () => {
    state.catalog.push({
      id: 'grok-4.6',
      contextWindow: 500_000,
      maxTokens: 500_000,
      reasoning: true,
    });
    fetchXai.mockRejectedValue(new Error('offline'));

    const listed = await queryModelMeta({ oauthAccountKey: 'xai', modelIds: [] });
    expect(listed.models.map((model) => model.modelId)).toEqual(['grok-4.6', 'grok-4.7']);

    fetchXai.mockClear();
    await queryModelMeta({ oauthAccountKey: 'xai', modelIds: ['grok-4.6'] });
    expect(fetchXai).not.toHaveBeenCalled();
  });
});
