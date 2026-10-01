import type { ModelProvider, PairCatalogPayload } from '@shared/types';
import { VIRTUAL_PROVIDER_ID, type VirtualModelEntry } from '@shared/virtualModels';
import {
  type OauthCredentialSnapshot,
  usableProvidersForOauthSnapshot,
} from '@/stores/oauthCredentials';

type PairProviderEntries = PairCatalogPayload['providers'];

/** 手机目录只收启用且凭证可用的 provider；密钥与账号 key 一律不下行。 */
export function toPairProviderEntries(
  providers: readonly ModelProvider[],
  snapshot: OauthCredentialSnapshot,
  virtualModels: readonly VirtualModelEntry[] = []
): PairProviderEntries {
  const entries: PairProviderEntries = usableProvidersForOauthSnapshot(providers, snapshot).map(
    (p) => ({
      id: p.id,
      name: p.name,
      models: p.models.map((m) => ({ id: m.id, ...(m.label ? { label: m.label } : {}) })),
    })
  );
  // 虚拟模型以伪 provider 下发：主模型可用才列出，Main 的 set-model/spawn 仍按虚拟配置解析
  const virtual = virtualModels.filter(
    (entry) =>
      entry.enabled &&
      entries.some(
        (p) =>
          p.id === entry.primary.providerId && p.models.some((m) => m.id === entry.primary.modelId)
      )
  );
  if (virtual.length > 0) {
    entries.unshift({
      id: VIRTUAL_PROVIDER_ID,
      name: 'Auto',
      models: virtual.map((entry) => ({ id: entry.id, label: entry.name })),
    });
  }
  return entries;
}

/**
 * OAuth 还没有真值、且当前可见列表为空时不结算。
 * 这种空列表是加载中的暂态，下发后会被 1.5s 去重把随后的真列表吞掉。
 */
export function pairProviderSyncPlan(
  providers: readonly ModelProvider[],
  snapshot: OauthCredentialSnapshot,
  virtualModels: readonly VirtualModelEntry[] = []
): { entries: PairProviderEntries; settled: boolean } {
  const entries = toPairProviderEntries(providers, snapshot, virtualModels);
  const status = snapshot.availability.status;
  const waiting = status === 'unloaded' || status === 'loading';
  const hasEnabledOauth = providers.some(
    (provider) => provider.enabled && provider.oauthAccountKey
  );
  return { entries, settled: !(waiting && hasEnabledOauth && entries.length === 0) };
}
