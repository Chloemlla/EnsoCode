import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ providers: [] as unknown[] }));
const getModelsOfType = vi.hoisted(() =>
  vi.fn((_type: string, provider: string) =>
    provider === 'openrouter' ? [{ id: 'typesafe/jev-1.13', name: 'Jev' }] : []
  )
);
vi.mock('./agentHost', () => ({ readSettingsState: () => state }));
vi.mock('./oauthProviders', () => ({ getRuntime: async () => ({ getModelsOfType }) }));

import { listClassifierModels } from './classifierModels';

describe('listClassifierModels', () => {
  it('只按设置里的条目 id 判定分类器来源，订阅多账号按基础 provider 列出', async () => {
    state.providers = [
      { id: 'or', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' },
      { id: 'or2', baseUrl: '', apiKey: '', oauthAccountKey: 'openrouter#2' },
      { id: 'other', baseUrl: 'https://api.anthropic.com', apiKey: 'k' },
    ];
    await expect(listClassifierModels('or')).resolves.toEqual([
      { id: 'typesafe/jev-1.13', name: 'Jev' },
    ]);
    await expect(listClassifierModels('or2')).resolves.toHaveLength(1);
    await expect(listClassifierModels('other')).resolves.toEqual([]);
    await expect(listClassifierModels('missing')).resolves.toEqual([]);
    await expect(listClassifierModels({ id: 'or' })).resolves.toEqual([]);
  });
});
