import type { ModelProvider } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { pairProviderSyncPlan, toPairProviderEntries } from './pairCatalogProviders';

function provider(id: string, overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id,
    name: id,
    api: 'openai-completions',
    apiKey: `key-${id}`,
    baseUrl: 'https://secret.example/v1',
    enabled: true,
    models: [
      { id: 'enabled', label: 'Enabled' },
      { id: 'disabled', enabled: false },
    ],
    ...overrides,
  };
}

describe('toPairProviderEntries', () => {
  it('includes authenticated subscription providers and strips secrets', () => {
    const entries = toPairProviderEntries(
      [
        provider('api'),
        provider('oauth-live', { apiKey: '', oauthAccountKey: 'anthropic#2' }),
        provider('oauth-logged-out', { apiKey: '', oauthAccountKey: 'anthropic#1' }),
        provider('disabled', { enabled: false }),
      ],
      {
        revision: 1,
        availability: {
          status: 'ready',
          authenticatedAccountKeys: new Set(['anthropic#2']),
        },
      }
    );
    expect(entries).toEqual([
      { id: 'api', name: 'api', models: [{ id: 'enabled', label: 'Enabled' }] },
      { id: 'oauth-live', name: 'oauth-live', models: [{ id: 'enabled', label: 'Enabled' }] },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/secret|key-api|anthropic#2/);
  });

  it('keeps API-key providers while OAuth is still loading', () => {
    expect(
      toPairProviderEntries(
        [provider('api'), provider('oauth', { apiKey: '', oauthAccountKey: 'anthropic' })],
        { revision: 1, availability: { status: 'loading' } }
      ).map((entry) => entry.id)
    ).toEqual(['api']);
  });

  it('只有 OAuth 且凭证未就绪时不结算，避免下发空列表', () => {
    expect(
      pairProviderSyncPlan([provider('oauth', { apiKey: '', oauthAccountKey: 'anthropic' })], {
        revision: 1,
        availability: { status: 'loading' },
      })
    ).toEqual({ entries: [], settled: false });
    expect(
      pairProviderSyncPlan([provider('oauth', { apiKey: '', oauthAccountKey: 'anthropic' })], {
        revision: 0,
        availability: { status: 'unloaded' },
      }).settled
    ).toBe(false);
  });

  it('API key 仍在时，OAuth 加载中也结算当前可见列表', () => {
    const plan = pairProviderSyncPlan(
      [provider('api'), provider('oauth', { apiKey: '', oauthAccountKey: 'anthropic' })],
      { revision: 1, availability: { status: 'loading' } }
    );
    expect(plan.settled).toBe(true);
    expect(plan.entries.map((entry) => entry.id)).toEqual(['api']);
  });

  it('凭证刷新失败是确定结果，要结算空列表', () => {
    expect(
      pairProviderSyncPlan([provider('oauth', { apiKey: '', oauthAccountKey: 'anthropic' })], {
        revision: 2,
        availability: { status: 'error', error: 'auth unavailable' },
      })
    ).toEqual({ entries: [], settled: true });
  });
});

describe('虚拟模型下发手机', () => {
  it('主模型可用的启用条目以伪 provider 置顶下发', () => {
    const snapshot = {
      revision: 1,
      availability: { status: 'ready' as const, authenticatedAccountKeys: new Set<string>() },
    };
    const entry = (id: string, primaryModel: string, enabled = true) => ({
      id,
      name: id.toUpperCase(),
      enabled,
      primary: { providerId: 'api', modelId: primaryModel },
      fallbacks: [],
    });
    const entries = toPairProviderEntries([provider('api')], snapshot, [
      entry('a', 'enabled'),
      entry('b', 'disabled'),
      entry('c', 'enabled', false),
    ]);
    expect(entries[0]).toEqual({
      id: 'enso-virtual',
      name: 'Auto',
      models: [{ id: 'a', label: 'A' }],
    });
    expect(entries).toHaveLength(2);
  });
});
