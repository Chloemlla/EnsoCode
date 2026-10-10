import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { createWebTools } from './web';

const exaReply = () =>
  new Response(
    `data: ${JSON.stringify({ result: { content: [{ type: 'text', text: 'Title: A\nURL: https://a.example/' }] } })}\n\n`,
    { status: 200 }
  );

function tools(fetch = vi.fn(async () => exaReply())) {
  const [search, fetchTool] = createWebTools({ fetch, lookup: async () => ['93.184.215.14'] });
  if (!search || !fetchTool) throw new Error('missing tools');
  return { search, fetchTool, fetch };
}

const ctx = (model?: unknown, auth: unknown = { ok: true, apiKey: 'k' }) =>
  ({
    model,
    modelRegistry: { getApiKeyAndHeaders: vi.fn(async () => auth) },
  }) as unknown as ExtensionToolContext;

describe('createWebTools', () => {
  it('an explicitly exhausted configuration never inserts the session model', async () => {
    const fetch = vi.fn(async () => exaReply());
    const [search] = createWebTools({ fetch, chain: () => [] });
    if (!search) throw new Error('missing tool');
    const result = await search.execute(
      'c1',
      { query: 'isolation' },
      undefined,
      undefined,
      ctx({
        provider: 'session',
        api: 'anthropic-messages',
        baseUrl: 'https://session.example',
        id: 'm',
      })
    );
    expect(result.details).toMatchObject({ source: 'exa' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/mcp\.exa\.ai/);
  });
  it('失效链不切到同名的其他 provider，也不插入会话模型', async () => {
    const fetch = vi.fn(async () => exaReply());
    const other = {
      provider: 'other-account',
      api: 'anthropic-messages',
      baseUrl: 'https://other.example',
      id: 'shared-model',
    };
    const registry = {
      find: vi.fn(() => undefined),
      getAll: vi.fn(() => [other]),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: 'other-secret' })),
    };
    const [search] = createWebTools({
      fetch,
      chain: () => [{ providerId: 'missing-account', modelId: other.id }],
    });
    if (!search) throw new Error('missing tool');
    const result = await search.execute('c1', { query: 'private query' }, undefined, undefined, {
      model: other,
      modelRegistry: registry,
    } as never);
    expect(result.details).toMatchObject({ source: 'exa' });
    expect(registry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/mcp\.exa\.ai/);
  });
  it('声明 web_search / web_fetch 且 schema 类型完整', () => {
    const { search, fetchTool } = tools();
    expect(search.name).toBe('web_search');
    expect(fetchTool.name).toBe('web_fetch');
    expect(search.parameters).toMatchObject({
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    });
    expect(fetchTool.parameters).toMatchObject({
      required: ['url'],
      properties: { url: { type: 'string' }, offset: { type: 'integer' } },
    });
  });

  it('schema 校验前归一参数：去空白、数字字符串 offset', () => {
    const { search, fetchTool } = tools();
    expect(search.prepareArguments?.({ query: '  node  ' })).toEqual({ query: 'node' });
    expect(fetchTool.prepareArguments?.({ url: ' https://a.example ', offset: '120' })).toEqual({
      url: 'https://a.example',
      offset: 120,
    });
    expect(fetchTool.prepareArguments?.({ url: 'https://a.example', offset: 'x' })).toEqual({
      url: 'https://a.example',
    });
  });

  it('凭据解析失败时降级 Exa，结果与 details 可观察', async () => {
    const { search } = tools();
    const result = await search.execute(
      'c1',
      { query: 'node' },
      undefined,
      undefined,
      ctx(
        { provider: 'p', api: 'anthropic-messages', baseUrl: 'https://gw', id: 'm' },
        { ok: false, error: 'no key' }
      )
    );
    const first = result.content[0];
    expect(first?.type === 'text' && first.text).toContain('via exa');
    expect(result.details).toMatchObject({
      source: 'exa',
      notes: expect.arrayContaining([expect.stringMatching(/no key/)]),
    });
  });

  it('空查询直接报错', async () => {
    const { search, fetch } = tools();
    await expect(search.execute('c1', { query: ' ' }, undefined, undefined, ctx())).rejects.toThrow(
      /query/
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('web_fetch 返回格式化正文', async () => {
    const fetch = vi.fn(
      async () => new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
    );
    const { fetchTool } = tools(fetch);
    const result = await fetchTool.execute(
      'c2',
      { url: 'https://a.example/' },
      undefined,
      undefined,
      ctx()
    );
    const first = result.content[0];
    expect(first?.type === 'text' && first.text).toContain('hello');
    expect(result.details).toMatchObject({ url: 'https://a.example/', status: 200 });
  });

  it('候选链经 modelRegistry 物化后依序执行；找不到的候选跳过并记 details.notes', async () => {
    const anthropicHit = {
      content: [
        {
          type: 'web_search_tool_result',
          tool_use_id: 't1',
          content: [{ type: 'web_search_result', title: 'N', url: 'https://n.example/' }],
        },
        { type: 'text', text: 'chain answer.' },
      ],
    };
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(anthropicHit), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const [search] = createWebTools({
      fetch,
      chain: () => [
        { providerId: 'gone', modelId: 'ghost' },
        { providerId: 'p', modelId: 'm' },
      ],
    });
    if (!search) throw new Error('missing tool');
    const registry = {
      find: vi.fn((providerId: string, modelId: string) =>
        providerId === 'p'
          ? { provider: 'p', api: 'anthropic-messages', baseUrl: 'https://gw', id: modelId }
          : undefined
      ),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: 'k' })),
    };
    const result = await search.execute('c1', { query: 'node' }, undefined, undefined, {
      modelRegistry: registry,
    } as never);
    const first = result.content[0];
    expect(first?.type === 'text' && first.text).toContain('via anthropic');
    expect(result.details).toMatchObject({ source: 'anthropic' });
    const notes = (result.details as { notes: string[] }).notes.join('\n');
    expect(notes).toMatch(/gone\/ghost.*skipped/);
    // 会话模型不被自动插队：请求打向链候选的网关
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://gw/v1/messages');
  });
});
