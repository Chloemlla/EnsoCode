import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
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
  }) as unknown as ExtensionContext;

describe('createWebTools', () => {
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
      notes: [expect.stringMatching(/no key/)],
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
});
