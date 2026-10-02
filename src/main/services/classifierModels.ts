import type { ModelProvider } from '@shared/types';
import { providerIdOfAccountKey } from '@shared/types/oauthProviders';
import { classifierProviderFor } from '@shared/virtualModels';
import { readSettingsState } from './agentHost';
import { getRuntime } from './oauthProviders';

/** 设置里该 provider 条目能用的 pi 分类器模型；入参只收条目 id，凭证与域名由 Main 按设置判定。 */
export async function listClassifierModels(
  providerId: unknown
): Promise<Array<{ id: string; name: string }>> {
  if (typeof providerId !== 'string' || !providerId) return [];
  const providers = readSettingsState()?.providers;
  const provider = Array.isArray(providers)
    ? (providers as ModelProvider[]).find((entry) => entry?.id === providerId)
    : undefined;
  if (!provider || typeof provider !== 'object') return [];
  const piProvider = classifierProviderFor(provider);
  if (!piProvider) return [];
  const runtime = await getRuntime();
  return runtime
    .getModelsOfType('classifier', providerIdOfAccountKey(piProvider))
    .map((model) => ({ id: model.id, name: model.name || model.id }));
}
