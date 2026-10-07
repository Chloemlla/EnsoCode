import {
  type DefaultModelRef,
  type ModelCredentialContext,
  type ModelUsability,
  modelUsability,
} from '../../../shared/defaultModel';
import type { SpawnModelConfig } from '../../../shared/types/agent';
import type { BotEngine } from '../../../shared/types/bot';
import type { ModelProvider } from '../../../shared/types/llm';
import { findVirtualModel, isVirtualRef, parseVirtualModels } from '../../../shared/virtualModels';
import { pickBotModel } from './botPrompt';

/** 实测成员模型的最短往返：worker 真实模型栈发一次性补全 */
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_ERROR_MAX = 80;

export type ModelProbeResult = { ok: true } | { ok: false; error: string };

export interface ModelProbeDeps {
  settings(): Record<string, unknown> | undefined;
  credentials(): Promise<ReadonlySet<string>>;
  resolve(
    ref: DefaultModelRef,
    keys: ReadonlySet<string>
  ): { ok: true; config: SpawnModelConfig } | { ok: false; error: string };
  isWorkerReady(): boolean;
  complete(request: {
    systemPrompt: string;
    userText: string;
    candidates: SpawnModelConfig[];
    timeoutMs: number;
    maxTokens: number;
  }): Promise<string>;
}

function providersFrom(state: Record<string, unknown> | undefined): ModelProvider[] {
  const providers = state?.providers;
  return Array.isArray(providers)
    ? providers.filter(
        (provider): provider is ModelProvider =>
          Boolean(provider) &&
          typeof provider === 'object' &&
          typeof (provider as ModelProvider).id === 'string'
      )
    : [];
}

/** 展示用模型名：虚拟条目用其名字，物理模型用「模型 id (供应商名)」 */
export function modelLabel(
  state: Record<string, unknown> | undefined,
  ref: DefaultModelRef
): string {
  if (isVirtualRef(ref))
    return findVirtualModel(parseVirtualModels(state?.virtualModels), ref)?.name ?? ref.modelId;
  const provider = providersFrom(state).find((item) => item.id === ref.providerId);
  return provider ? `${ref.modelId} (${provider.name})` : ref.modelId;
}

function usabilityReasonText(reason: ModelUsability): string {
  switch (reason) {
    case 'missing-selection':
      return '未配置模型';
    case 'provider-missing':
      return '找不到供应商';
    case 'provider-disabled':
      return '供应商已停用';
    case 'model-missing':
      return '模型不存在';
    case 'model-disabled':
      return '模型已停用';
    case 'api-key-missing':
      return '缺少 API Key';
    case 'oauth-account-missing':
      return '订阅账号不可用';
    case 'oauth-credentials-loading':
      return '订阅凭证加载中';
    case 'oauth-credentials-error':
      return '订阅凭证读取失败';
    default:
      return '未加载订阅凭证';
  }
}

/** 配置层面为什么不可用；给「哪个模型 + 原因」的可读一句 */
export function describeModelIssue(
  state: Record<string, unknown> | undefined,
  ref: DefaultModelRef,
  keys?: ReadonlySet<string>
): string {
  const credentials: ModelCredentialContext = {
    oauthCredentials: {
      status: 'ready',
      authenticatedAccountKeys: keys ?? new Set<string>(),
    },
  };
  const reason = modelUsability(
    ref,
    providersFrom(state),
    credentials,
    parseVirtualModels(state?.virtualModels)
  );
  return `模型 ${modelLabel(state, ref)} 不可用：${usabilityReasonText(reason)}`;
}

/** 底层错误归类成一句原因；已可读的（含「：」或纯中文）原文透出并截断 */
export function briefErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const text = message.trim();
  if (!text) return '未知错误';
  if (/^agent worker is not running/i.test(text)) return '会话服务未启动';
  if (/aborted|cancelled|canceled/i.test(text)) return '已取消';
  if (/model[- ]missing/.test(text)) return '模型不存在';
  const classified =
    /401|403|unauthorized|forbidden|authentication|invalid.{0,20}(key|token)|api.?key/i.test(text)
      ? '鉴权失败'
      : /429|rate.?limit|too many requests/i.test(text)
        ? '请求被限流'
        : /404|model.{0,20}(not found|does not exist|不存在)|no such model/i.test(text)
          ? '模型不存在'
          : /fetch failed|connection error|econn|enotfound|eai_again|socket|network|econnreset|dns|getaddrinfo|etimedout/i.test(
                text
              )
            ? '网络连接失败'
            : /timed? ?out|timeout|超时/i.test(text)
              ? '调用超时'
              : null;
  const reason = classified ?? text;
  return reason.length > PROBE_ERROR_MAX ? `${reason.slice(0, PROBE_ERROR_MAX)}…` : reason;
}

/** 解析失败原因行：'Model is unavailable: <reason>' → 可读原因；模型名取 label */
function resolveErrorText(
  state: Record<string, unknown> | undefined,
  ref: DefaultModelRef,
  error: string
): string {
  const match = /^Model is unavailable: (.+)$/.exec(error);
  const reason = match
    ? (usabilityReasonText(match[1] as ModelUsability) ?? match[1])
    : briefErrorReason(error);
  return `模型 ${modelLabel(state, ref)}：${reason}`;
}

/**
 * 成员模型实测：解析配置（成员模型优先，失败不回落默认）→ 真发一次 ping。
 * 同一模型配置通过后缓存；失败不缓存，下次投递重新实测。
 */
export function createModelProbe(
  deps: ModelProbeDeps
): (engine: BotEngine | undefined) => Promise<ModelProbeResult> {
  const passed = new Set<string>();
  return async (engine) => {
    const state = deps.settings();
    let keys: ReadonlySet<string>;
    try {
      keys = await deps.credentials();
    } catch {
      return { ok: false, error: '模型凭证读取失败' };
    }
    const picked = pickBotModel(engine, state ?? {}, () => true);
    if (!picked) return { ok: false, error: '未配置可用模型' };
    const resolved = deps.resolve({ providerId: picked.providerId, modelId: picked.modelId }, keys);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolveErrorText(
          state,
          { providerId: picked.providerId, modelId: picked.modelId },
          resolved.error
        ),
      };
    }
    const signature = JSON.stringify(resolved.config);
    if (passed.has(signature)) return { ok: true };
    if (!deps.isWorkerReady()) return { ok: false, error: '会话服务未启动' };
    try {
      await deps.complete({
        systemPrompt: 'You are a connectivity check. Reply with OK.',
        userText: 'ping',
        candidates: [resolved.config],
        timeoutMs: PROBE_TIMEOUT_MS,
        maxTokens: 16,
      });
      passed.add(signature);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: `模型 ${modelLabel(state, { providerId: picked.providerId, modelId: picked.modelId })}：${briefErrorReason(error)}`,
      };
    }
  };
}
