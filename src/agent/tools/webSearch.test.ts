import { describe, expect, it, vi } from 'vitest';
import { formatSearchResult, type SearchModel, webSearch } from './webSearch';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sse = (events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const exaReply = () =>
  new Response(
    `event: message\ndata: ${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          { type: 'text', text: 'Title: Node.js\nURL: https://nodejs.org/\nHighlights: fast' },
        ],
      },
    })}\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );

const anthropicModel: SearchModel = {
  provider: 'max',
  api: 'anthropic-messages',
  baseUrl: 'https://gw.example',
  id: 'claude-x',
  headers: { 'User-Agent': 'enso' },
};
const auth = async () => ({ apiKey: 'sk-test' });

const anthropicHit = {
  content: [
    { type: 'server_tool_use', id: 't1', name: 'web_search', input: { query: 'node' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 't1',
      content: [
        { type: 'web_search_result', title: 'Node.js', url: 'https://nodejs.org/', page_age: '1d' },
      ],
    },
    { type: 'text', text: 'Node 26 is current.' },
  ],
};

function urlOf(call: unknown): string {
  return String((call as unknown[])[0]);
}
function initOf(fetch: { mock: { calls: unknown[] } }, index: number): RequestInit {
  return (fetch.mock.calls[index] as [string, RequestInit])[1];
}

describe('webSearch', () => {
  it('Anthropic 原生搜索：带 server tool 请求并解析结果', async () => {
    const fetch = vi.fn(async () => json(anthropicHit));
    const { outcome } = await webSearch(
      'node',
      { model: anthropicModel, auth },
      { fetch, unsupported: new Set() }
    );
    expect(urlOf(fetch.mock.calls[0])).toBe('https://gw.example/v1/messages');
    const init = initOf(fetch, 0);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['User-Agent']).toBe('enso');
    expect(JSON.parse(String(init.body)).tools[0]).toMatchObject({
      type: 'web_search_20250305',
      name: 'web_search',
    });
    expect(outcome).toMatchObject({
      source: 'anthropic',
      answer: 'Node 26 is current.',
      hits: [{ title: 'Node.js', url: 'https://nodejs.org/' }],
    });

    await webSearch(
      'node',
      { model: { ...anthropicModel, baseUrl: 'https://gw.example/v1/' }, auth },
      { fetch, unsupported: new Set() }
    );
    expect(urlOf(fetch.mock.calls[1])).toBe('https://gw.example/v1/messages');
  });

  it('网关静默忽略搜索工具时降级到 Exa，并在本会话记住不再尝试', async () => {
    const unsupported = new Set<string>();
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://mcp.exa.ai')
        ? exaReply()
        : json({ content: [{ type: 'text', text: 'from memory' }] })
    );
    const first = await webSearch('node', { model: anthropicModel, auth }, { fetch, unsupported });
    expect(first.outcome.source).toBe('exa');
    expect(first.outcome.hits).toEqual([{ title: 'Node.js', url: 'https://nodejs.org/' }]);
    expect(first.notes.join('\n')).toMatch(/did not run a web search/);
    expect(fetch).toHaveBeenCalledTimes(2);

    await webSearch('node', { model: anthropicModel, auth }, { fetch, unsupported });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(urlOf(fetch.mock.calls[2])).toMatch(/^https:\/\/mcp\.exa\.ai\/mcp/);
  });

  it('临时错误（429）降级但不记为不支持', async () => {
    const unsupported = new Set<string>();
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://mcp.exa.ai') ? exaReply() : json({ error: 'busy' }, 429)
    );
    const { outcome } = await webSearch(
      'node',
      { model: anthropicModel, auth },
      { fetch, unsupported }
    );
    expect(outcome.source).toBe('exa');
    expect(unsupported.size).toBe(0);
  });

  it('原生搜索没有带回任何来源时视为未搜索，降级并记住', async () => {
    const unsupported = new Set<string>();
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://mcp.exa.ai')
        ? exaReply()
        : json({
            content: [
              { type: 'web_search_tool_result', tool_use_id: 't1', content: [] },
              { type: 'text', text: 'guess' },
            ],
          })
    );
    const { outcome } = await webSearch(
      'node',
      { model: anthropicModel, auth },
      { fetch, unsupported }
    );
    expect(outcome.source).toBe('exa');
    expect(unsupported.size).toBe(1);
  });

  it('OpenAI Responses 流式原生搜索', async () => {
    const fetch = vi.fn(async () =>
      sse([
        {
          type: 'response.output_item.done',
          item: {
            type: 'web_search_call',
            action: { type: 'search', sources: [{ url: 'https://a.example/', title: 'A' }] },
          },
        },
        { type: 'response.output_text.delta', delta: 'Answer ' },
        { type: 'response.output_text.delta', delta: 'text' },
        {
          type: 'response.output_text.annotation.added',
          annotation: { type: 'url_citation', url: 'https://b.example/', title: 'B' },
        },
        { type: 'response.completed', response: { output: [] } },
      ])
    );
    const { outcome } = await webSearch(
      'q',
      {
        model: {
          provider: 'openai',
          api: 'openai-responses',
          baseUrl: 'https://api.x/v1',
          id: 'm',
        },
        auth,
      },
      { fetch, unsupported: new Set() }
    );
    expect(urlOf(fetch.mock.calls[0])).toBe('https://api.x/v1/responses');
    const init = initOf(fetch, 0);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      tools: [{ type: 'web_search' }],
      stream: true,
    });
    expect(outcome).toMatchObject({
      source: 'openai',
      answer: 'Answer text',
      hits: [
        { title: 'A', url: 'https://a.example/' },
        { title: 'B', url: 'https://b.example/' },
      ],
    });
  });

  it('ChatGPT 订阅走 codex 端点并带账号头', async () => {
    const payload = { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } };
    const token = `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
    const fetch = vi.fn(async () =>
      sse([
        {
          type: 'response.output_item.done',
          item: {
            type: 'web_search_call',
            action: { type: 'search', sources: [{ url: 'https://c.example/' }] },
          },
        },
        { type: 'response.output_text.delta', delta: 'ok' },
      ])
    );
    await webSearch(
      'q',
      {
        model: {
          provider: 'openai-codex',
          api: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
          id: 'gpt',
        },
        auth: async () => ({ apiKey: token }),
      },
      { fetch, unsupported: new Set() }
    );
    expect(urlOf(fetch.mock.calls[0])).toBe('https://chatgpt.com/backend-api/codex/responses');
    const init = initOf(fetch, 0);
    expect((init.headers as Record<string, string>)['chatgpt-account-id']).toBe('acct-1');
    expect(JSON.parse(String(init.body)).instructions).toBeTruthy();
  });

  it('Gemini 原生搜索解析 grounding', async () => {
    const fetch = vi.fn(async () =>
      json({
        candidates: [
          {
            content: { parts: [{ text: 'Gemini answer' }] },
            groundingMetadata: {
              webSearchQueries: ['q'],
              groundingChunks: [{ web: { uri: 'https://g.example/', title: 'G' } }],
            },
          },
        ],
      })
    );
    const { outcome } = await webSearch(
      'q',
      {
        model: {
          provider: 'gemma',
          api: 'google-generative-ai',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          id: 'gemini-x',
        },
        auth,
      },
      { fetch, unsupported: new Set() }
    );
    expect(urlOf(fetch.mock.calls[0])).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent'
    );
    expect(initOf(fetch, 0).headers).toMatchObject({
      'x-goog-api-key': 'sk-test',
    });
    expect(outcome).toMatchObject({
      source: 'gemini',
      answer: 'Gemini answer',
      hits: [{ title: 'G', url: 'https://g.example/' }],
    });
  });

  it('不支持原生搜索的协议或无模型时直接用 Exa', async () => {
    const fetch = vi.fn(async () => exaReply());
    for (const model of [
      { provider: 'p', api: 'openai-completions', baseUrl: 'https://x', id: 'm' },
      undefined,
    ]) {
      const { outcome } = await webSearch('q', { model, auth }, { fetch, unsupported: new Set() });
      expect(outcome.source).toBe('exa');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('所有来源都失败时报出每个来源的原因', async () => {
    const fetch = vi.fn(async () => json({ error: 'nope' }, 500));
    await expect(
      webSearch('q', { model: anthropicModel, auth }, { fetch, unsupported: new Set() })
    ).rejects.toThrow(/anthropic.*500[\s\S]*exa.*500/);
  });

  it('Exa 返回无结果的提示文本（如限流）时按失败处理', async () => {
    const limited = () =>
      new Response(
        `data: ${JSON.stringify({ result: { content: [{ type: 'text', text: "You've hit Exa's free MCP rate limit." }] } })}\n\n`,
        { status: 200 }
      );
    const fetch = vi.fn(async () => limited());
    await expect(
      webSearch('q', { model: undefined, auth }, { fetch, unsupported: new Set() })
    ).rejects.toThrow(/exa: You've hit Exa's free MCP rate limit/);
  });

  it('格式化结果带来源与不可信提示', () => {
    const text = formatSearchResult('node', {
      source: 'anthropic',
      answer: 'Node 26',
      hits: [{ title: 'Node.js', url: 'https://nodejs.org/', age: '1d' }],
    });
    expect(text).toContain('Node 26');
    expect(text).toContain('1. [Node.js](https://nodejs.org/) (1d)');
    expect(text).toMatch(/untrusted/i);
  });
});
