import {
  type Api,
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Message,
  type Model,
  type ModelThinkingLevel,
  type Provider,
} from '@earendil-works/pi-ai';
import type { ModelRoute, ModelRouteRequest, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { SpawnModelConfig } from '@shared/types';
import { VIRTUAL_PROVIDER_ID } from '@shared/virtualModels';

export interface VirtualMembers {
  primary: Model<Api>;
  fast?: Model<Api>;
  fallbacks: Model<Api>[];
}

export type VirtualTier = 'simple' | 'complex';

/** 写在会话分支上的路由状态；只在变化时返回新对象，避免每个请求都追加条目。 */
export interface VirtualRouterState {
  /** 本轮已失败的成员（provider/id），新一轮用户输入时清空 */
  failed?: string[];
  /** 分类器生效的档位与连续判为 simple 的轮数（降档滞回用） */
  tier?: VirtualTier;
  simpleStreak?: number;
}

/** 新一轮用户输入时的档位选择（分类器）；返回首选成员与要合并的状态。 */
export type VirtualChooser = (
  request: ModelRouteRequest<VirtualRouterState>,
  members: VirtualMembers
) => Promise<{ preferred?: Model<Api>; state?: VirtualRouterState } | undefined>;

/** 上下文预估超过窗口这个比例就换窗口更大的成员；留余量给输出与系统提示 */
const CONTEXT_HEADROOM = 0.85;

export const memberKey = (model: Pick<Model<Api>, 'provider' | 'id'>): string =>
  `${model.provider}/${model.id}`;

const registry = new Map<string, VirtualMembers>();

export function isVirtualPiModel(model: { api?: string } | undefined): boolean {
  return model?.api === 'pi-virtual';
}

/** 不走路由的直接调用（压缩摘要、记忆提炼）要的真实模型：快模型优先。 */
export function directModelFor<T extends { api?: string; id?: string }>(model: T): T | Model<Api> {
  if (!isVirtualPiModel(model)) return model;
  const members = model.id ? registry.get(model.id) : undefined;
  return members ? (members.fast ?? members.primary) : model;
}

/** 有序去重的候选：主模型 → 备用 → 快模型（故障转移的最后手段） */
function chain(members: VirtualMembers): Model<Api>[] {
  const ordered: Model<Api>[] = [];
  for (const model of [members.primary, ...members.fallbacks, members.fast]) {
    if (model && !ordered.some((kept) => memberKey(kept) === memberKey(model))) ordered.push(model);
  }
  return ordered;
}

function isImagePart(part: unknown): boolean {
  return Boolean(part) && typeof part === 'object' && (part as { type?: unknown }).type === 'image';
}

/** 最近一次 assistant 之后的输入（本轮用户消息 / 工具结果）是否带图片 */
export function pendingInputHasImage(messages: readonly Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === 'assistant') return false;
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content) && content.some(isImagePart)) return true;
  }
  return false;
}

interface UsageLike {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
}

/** 粗估请求体 token：最近一次响应的用量 + 之后新增内容按 4 字符 1 token。 */
export function estimateRequestTokens(messages: readonly Message[]): number {
  let base = 0;
  let tail = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === 'assistant') {
      const usage = (message as { usage?: UsageLike }).usage;
      base =
        usage?.totalTokens || (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.output ?? 0);
      if (base > 0) break;
    }
    tail += JSON.stringify((message as { content?: unknown }).content ?? '').length;
  }
  return base + Math.ceil(tail / 4);
}

const acceptsImages = (model: Model<Api>): boolean => model.input.includes('image');
const fitsContext = (model: Model<Api>, tokens: number): boolean =>
  !(model.contextWindow > 0) || tokens <= model.contextWindow * CONTEXT_HEADROOM;

/** 候选里第一个满足图片与上下文需求的成员；都不满足时退回第一个（交给 pi 压缩/报错）。 */
function pick(
  candidates: readonly Model<Api>[],
  needs: { image: boolean; tokens: number }
): Model<Api> | undefined {
  return (
    candidates.find(
      (model) => (!needs.image || acceptsImages(model)) && fitsContext(model, needs.tokens)
    ) ??
    candidates.find((model) => !needs.image || acceptsImages(model)) ??
    candidates[0]
  );
}

function findMember(
  members: VirtualMembers,
  model: Model<Api> | undefined
): Model<Api> | undefined {
  if (!model) return undefined;
  return chain(members).find((member) => memberKey(member) === memberKey(model));
}

/**
 * 路由（纯函数）：
 * - direct（摘要等）→ 快模型；
 * - retry → 本轮未失败的下一个成员（故障转移）；
 * - continuation → 沿用上一个成员保住 prompt cache，仅在新输入带图而它不收图时换；
 * - user → 首选成员（分类器给出，缺省主模型），按图片/上下文需求补位，清空失败记录。
 */
export function routeVirtualRequest(
  request: ModelRouteRequest<VirtualRouterState>,
  members: VirtualMembers,
  choice?: { preferred?: Model<Api>; state?: VirtualRouterState }
): ModelRoute<VirtualRouterState> {
  // 会话关掉推理时虚拟模型 reasoning=false，但 pi 仍会带着原档位来路由
  const reasoning = request.model.reasoning !== false && request.thinkingLevel !== 'off';
  const finish = (
    model: Model<Api>,
    state?: VirtualRouterState
  ): ModelRoute<VirtualRouterState> => {
    const thinkingLevel: ModelThinkingLevel = reasoning
      ? clampThinkingLevel(model, request.thinkingLevel)
      : 'off';
    return { model, thinkingLevel, ...(state ? { state } : {}) };
  };
  const previousState = request.state ?? {};
  const ordered = chain(members);
  const needs = {
    image: pendingInputHasImage(request.messages),
    tokens: estimateRequestTokens(request.messages),
  };

  if (request.reason === 'direct') return finish(members.fast ?? members.primary);

  if (request.reason === 'retry' && request.failed) {
    const failed = new Set([...(previousState.failed ?? []), memberKey(request.failed.model)]);
    const next = pick(
      ordered.filter((model) => !failed.has(memberKey(model))),
      needs
    );
    const state = { ...previousState, failed: [...failed] };
    return finish(next ?? findMember(members, request.failed.model) ?? members.primary, state);
  }

  if (request.reason === 'continuation') {
    const previous = findMember(members, request.previous?.model);
    if (previous && (!needs.image || acceptsImages(previous))) return finish(previous);
    const failed = new Set(previousState.failed ?? []);
    const next = pick(
      ordered.filter((model) => !failed.has(memberKey(model))),
      needs
    );
    return finish(next ?? members.primary);
  }

  // user（以及 pi 未给 failed 的 retry）：新一轮重新从首选成员开始
  const start = choice?.preferred ?? members.primary;
  const candidates = [start, ...ordered.filter((model) => memberKey(model) !== memberKey(start))];
  const target = pick(candidates, needs) ?? members.primary;
  const merged: VirtualRouterState = { ...previousState, ...choice?.state };
  if (merged.failed?.length) merged.failed = [];
  const changed = JSON.stringify(merged) !== JSON.stringify(previousState);
  return finish(target, changed ? merged : undefined);
}

const ADAPTIVE_WRAPPED = Symbol('enso.adaptiveThinking');

/**
 * pi 按目录模型（每次取出都是新副本）发出路由后的请求，会话里就地改 compat 的做法对成员无效。
 * 在 provider 出口按同一判定补 forceAdaptiveThinking：开推理且模型支持 adaptive 时补上；
 * 已显式设置（会话直连时 applyReasoningToModel 写入）的保持不动。
 */
export function withAdaptiveThinking(
  provider: Provider,
  supportsAdaptive: (modelId: string) => boolean
): Provider {
  if ((provider as { [ADAPTIVE_WRAPPED]?: true })[ADAPTIVE_WRAPPED]) return provider;
  const patch = <T extends Model<Api>>(model: T): T => {
    if (model.api !== 'anthropic-messages' || !model.reasoning) return model;
    const compat = model.compat as { forceAdaptiveThinking?: boolean } | undefined;
    if (compat && 'forceAdaptiveThinking' in compat) return model;
    if (!supportsAdaptive(model.id)) return model;
    return { ...model, compat: { ...compat, forceAdaptiveThinking: true } } as T;
  };
  const wrapped: Provider = {
    ...provider,
    stream: (model, context, options) => provider.stream(patch(model), context, options),
    streamSimple: (model, context, options) =>
      provider.streamSimple(patch(model), context, options),
  };
  return Object.assign(wrapped, { [ADAPTIVE_WRAPPED]: true as const });
}

export interface VirtualModelRegistration {
  model: Model<Api>;
  members: VirtualMembers;
}

/**
 * 解析成员并注册 pi 虚拟模型。重复注册替换定义；已持有旧模型对象的会话下个请求即用新路由。
 * 必须早于 createAgentSession 恢复分支，否则 pi 会静默回退到分支里最后一个真实模型。
 */
export async function registerVirtualModel(
  runtime: ModelRuntime,
  config: SpawnModelConfig,
  resolveMember: (member: SpawnModelConfig) => Promise<Model<Api>>,
  choose?: VirtualChooser
): Promise<VirtualModelRegistration> {
  const virtual = config.virtual;
  if (!virtual) throw new Error('not a virtual model config');
  const primary = await resolveMember(virtual.primary);
  const optional = async (member: SpawnModelConfig) => {
    try {
      return await resolveMember(member);
    } catch (error) {
      console.warn(`[virtual-model] member ${member.modelId} unavailable:`, error);
      return undefined;
    }
  };
  const fast = virtual.fast ? await optional(virtual.fast) : undefined;
  const fallbacks = (await Promise.all(virtual.fallbacks.map(optional))).filter(
    (model): model is Model<Api> => model !== undefined
  );
  const members: VirtualMembers = { primary, ...(fast ? { fast } : {}), fallbacks };
  const all = chain(members);
  const windows = all.map((model) => model.contextWindow).filter((value) => value > 0);
  const outputs = all.map((model) => model.maxTokens).filter((value) => value > 0);
  const levels = new Set<ModelThinkingLevel>(['off']);
  for (const model of all) {
    for (const level of getSupportedThinkingLevels({ ...model, reasoning: true })) {
      levels.add(level);
    }
  }
  registry.set(config.modelId, members);
  runtime.registerVirtualModel({
    provider: VIRTUAL_PROVIDER_ID,
    id: config.modelId,
    name: virtual.name,
    thinkingLevels: [...levels],
    // 首个响应前的上限按最小成员估，避免占用显示过于乐观
    ...(windows.length > 0 ? { contextWindow: Math.min(...windows) } : {}),
    ...(outputs.length > 0 ? { maxTokens: Math.min(...outputs) } : {}),
    input: all.some(acceptsImages) ? ['text', 'image'] : ['text'],
    route: async (request: ModelRouteRequest) => {
      const typed = request as ModelRouteRequest<VirtualRouterState>;
      const choice =
        typed.reason === 'user' && choose
          ? await choose(typed, members).catch((error) => {
              console.warn('[virtual-model] classifier failed:', error);
              return undefined;
            })
          : undefined;
      return routeVirtualRequest(typed, members, choice);
    },
  });
  const model = runtime.getModel(VIRTUAL_PROVIDER_ID, config.modelId);
  if (!model) throw new Error(`virtual model not found after register: ${config.modelId}`);
  return { model, members };
}
