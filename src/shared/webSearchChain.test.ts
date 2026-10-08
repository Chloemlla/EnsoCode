import { describe, expect, it } from 'vitest';
import {
  isXaiResponsesHost,
  nativeSearchKindFor,
  parseWebSearchChain,
  WEB_SEARCH_CHAIN_MAX,
  webSearchCandidateProviders,
} from './webSearchChain';

describe('nativeSearchKindFor', () => {
  it('按 api 映射通道；antigravity 走 CCA grounding', () => {
    expect(nativeSearchKindFor('anthropic-messages', '')).toBe('anthropic');
    expect(nativeSearchKindFor('openai-responses', '')).toBe('responses');
    expect(nativeSearchKindFor('openai-codex-responses', '')).toBe('codex');
    expect(nativeSearchKindFor('google-generative-ai', '')).toBe('gemini');
    expect(nativeSearchKindFor('google-antigravity', '')).toBe('antigravity');
  });

  it('openai-completions 仅官方 xAI 主机走 responses；中转与未知 api 无原生能力', () => {
    expect(nativeSearchKindFor('openai-completions', 'https://api.x.ai/v1')).toBe('responses');
    expect(nativeSearchKindFor('openai-completions', 'https://api.x.ai.evil.com')).toBeUndefined();
    expect(
      nativeSearchKindFor('openai-completions', 'https://cli-chat-proxy.grok.com')
    ).toBeUndefined();
    expect(nativeSearchKindFor('openai-completions', 'not a url')).toBeUndefined();
    expect(nativeSearchKindFor('kimi-coding', '')).toBeUndefined();
    expect(nativeSearchKindFor('typesafe-system-one', '')).toBeUndefined();
  });

  it('isXaiResponsesHost 只认精确 hostname', () => {
    expect(isXaiResponsesHost('https://api.x.ai')).toBe(true);
    expect(isXaiResponsesHost('https://api.x.ai:443/v1')).toBe(true);
    expect(isXaiResponsesHost('https://sub.api.x.ai')).toBe(false);
  });
});

describe('parseWebSearchChain', () => {
  it('非数组/非法条目收窄为空链', () => {
    expect(parseWebSearchChain(undefined)).toEqual([]);
    expect(parseWebSearchChain('x')).toEqual([]);
    expect(parseWebSearchChain([null, {}, { providerId: 1, modelId: 'm' }])).toEqual([]);
  });

  it('修剪空白、去重、截断到上限', () => {
    const many = Array.from({ length: WEB_SEARCH_CHAIN_MAX + 3 }, (_, i) => ({
      providerId: `p${i}`,
      modelId: 'm',
    }));
    const parsed = parseWebSearchChain([
      { providerId: ' p1 ', modelId: ' m1 ' },
      { providerId: 'p1', modelId: 'm1' },
      ...many,
    ]);
    expect(parsed[0]).toEqual({ providerId: 'p1', modelId: 'm1' });
    expect(parsed).toHaveLength(WEB_SEARCH_CHAIN_MAX);
    expect(new Set(parsed.map((e) => `${e.providerId}/${e.modelId}`)).size).toBe(parsed.length);
  });
});

describe('webSearchCandidateProviders', () => {
  type Fixture = {
    id: string;
    enabled?: boolean;
    oauthAccountPool?: unknown;
    api: string;
    baseUrl: string;
  };
  const provider = (extra: Record<string, unknown>): Fixture =>
    ({
      id: 'p',
      api: 'openai-completions',
      baseUrl: 'https://api.x.ai/v1',
      enabled: true,
      ...extra,
    }) as Fixture;

  it('只保留有原生搜索能力的启用条目；pool 与禁用排除', () => {
    const list = [
      provider({ id: 'xai' }), // openai-completions + api.x.ai → responses ✓
      provider({ id: 'kimi', api: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding' }), // 无 kind
      provider({ id: 'ag', api: 'google-antigravity', baseUrl: '' }), // antigravity ✓
      provider({ id: 'off', enabled: false }), // 禁用
      provider({
        id: 'pool',
        api: 'openai-codex-responses',
        oauthAccountPool: { accountKeys: ['openai-codex'] },
      }), // pool v1 不支持
      provider({
        id: 'ga',
        api: 'google-generative-ai',
        baseUrl: 'https://generativelanguage.googleapis.com',
      }), // ✓
    ];
    const out = webSearchCandidateProviders(list);
    expect(out.map((p) => p.id)).toEqual(['xai', 'ag', 'ga']);
  });
});
