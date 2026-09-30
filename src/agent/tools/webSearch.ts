import { UNTRUSTED_WEB_NOTICE } from './webFetch';

/** ctx.model 的最小形状（pi Model<Api> 的子集） */
export interface SearchModel {
  provider: string;
  api: string;
  baseUrl: string;
  id: string;
  headers?: Record<string, string>;
}

export interface SearchAuth {
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface SearchHit {
  title: string;
  url: string;
  age?: string;
}

export interface SearchOutcome {
  source: 'anthropic' | 'openai' | 'gemini' | 'exa';
  answer?: string;
  hits: SearchHit[];
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface WebSearchDeps {
  fetch?: FetchLike;
  /** 本会话已确认不支持原生搜索的模型键 */
  unsupported: Set<string>;
}

const NATIVE_TIMEOUT_MS = 90_000;
const EXA_TIMEOUT_MS = 30_000;
const EXA_MCP_URL = 'https://mcp.exa.ai/mcp?tools=web_search_exa';
const MAX_ANSWER_CHARS = 20_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** 请求成功但没带回任何来源（网关丢弃了 server tool 或返回空壳结果） */
class NoSearchPerformed extends Error {
  constructor() {
    super('the model endpoint did not run a web search');
  }
}

const isUnsupported = (error: unknown) =>
  error instanceof NoSearchPerformed ||
  (error instanceof HttpError && [400, 404, 405, 422, 501].includes(error.status));

async function post(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  const response = await fetchImpl(url, { method: 'POST', ...init });
  if (!response.ok) throw new HttpError(response.status, await response.text().catch(() => ''));
  return response;
}

function pushHit(hits: SearchHit[], hit: Partial<SearchHit>) {
  if (typeof hit.url !== 'string' || !/^https?:\/\//.test(hit.url)) return;
  if (hits.some((existing) => existing.url === hit.url)) return;
  hits.push({
    title: typeof hit.title === 'string' && hit.title.trim() ? hit.title.trim() : hit.url,
    url: hit.url,
    ...(typeof hit.age === 'string' && hit.age ? { age: hit.age } : {}),
  });
}

function prompt(query: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Today is ${today}. Search the web and answer concisely with the key facts, citing sources.\n\nQuery: ${query}`;
}

function sseEvents(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // 跳过残缺帧
    }
  }
  return events;
}

type Kind = 'anthropic' | 'responses' | 'codex' | 'gemini';

function nativeKind(model: SearchModel): Kind | undefined {
  switch (model.api) {
    case 'anthropic-messages':
      return 'anthropic';
    case 'openai-responses':
      return 'responses';
    case 'openai-codex-responses':
      return 'codex';
    case 'google-generative-ai':
      return 'gemini';
    default:
      return undefined;
  }
}

const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

async function anthropicSearch(
  query: string,
  model: SearchModel,
  auth: SearchAuth,
  signal: AbortSignal,
  fetchImpl: FetchLike
): Promise<SearchOutcome> {
  const base = trimBase(model.baseUrl);
  const oauth = auth.apiKey?.startsWith('sk-ant-oat') === true;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...model.headers,
    ...auth.headers,
  };
  if (auth.apiKey && oauth) {
    headers.authorization = `Bearer ${auth.apiKey}`;
    headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
  } else if (auth.apiKey) {
    headers['x-api-key'] = auth.apiKey;
  }
  const response = await post(fetchImpl, `${base.endsWith('/v1') ? base : `${base}/v1`}/messages`, {
    signal,
    headers,
    body: JSON.stringify({
      model: model.id,
      max_tokens: 4096,
      // 订阅 OAuth 端点要求 Claude Code 系统提示，否则报不透明的 429
      ...(oauth ? { system: "You are Claude Code, Anthropic's official CLI for Claude." } : {}),
      messages: [{ role: 'user', content: prompt(query) }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    }),
  });
  const body = (await response.json()) as { content?: Array<Record<string, unknown>> };
  const hits: SearchHit[] = [];
  let answer = '';
  for (const block of body.content ?? []) {
    if (block.type === 'web_search_tool_result') {
      const content = block.content as Record<string, unknown> | Array<Record<string, unknown>>;
      if (!Array.isArray(content)) {
        throw new Error(`web search error: ${String(content?.error_code ?? 'unknown')}`);
      }
      for (const item of content) {
        pushHit(hits, {
          title: item.title as string,
          url: item.url as string,
          age: item.page_age as string,
        });
      }
    } else if (block.type === 'text' && typeof block.text === 'string') {
      answer += block.text;
      for (const citation of (block.citations as Array<Record<string, unknown>>) ?? []) {
        pushHit(hits, { title: citation.title as string, url: citation.url as string });
      }
    }
  }
  if (hits.length === 0) throw new NoSearchPerformed();
  return { source: 'anthropic', answer: answer.trim(), hits };
}

function codexAccountId(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
    const id = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

async function responsesSearch(
  query: string,
  model: SearchModel,
  auth: SearchAuth,
  signal: AbortSignal,
  fetchImpl: FetchLike,
  codex: boolean
): Promise<SearchOutcome> {
  const base = trimBase(model.baseUrl);
  const url = codex
    ? base.endsWith('/codex/responses')
      ? base
      : `${base.replace(/\/codex$/, '')}/codex/responses`
    : base.endsWith('/responses')
      ? base
      : `${base}/responses`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...model.headers,
    ...auth.headers,
  };
  if (auth.apiKey) headers.authorization = `Bearer ${auth.apiKey}`;
  if (codex) {
    const accountId = auth.apiKey ? codexAccountId(auth.apiKey) : undefined;
    if (accountId) headers['chatgpt-account-id'] = accountId;
    headers.originator ??= 'codex_cli_rs';
  }
  const response = await post(fetchImpl, url, {
    signal,
    headers,
    body: JSON.stringify({
      model: model.id,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt(query) }] }],
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
      stream: true,
      store: false,
      ...(codex
        ? {
            instructions: 'Answer the user request using web search.',
            tool_choice: 'required',
          }
        : {}),
    }),
  });
  const hits: SearchHit[] = [];
  let answer = '';
  const collectItem = (item: Record<string, unknown> | undefined) => {
    if (item?.type === 'web_search_call') {
      const action = (item.action ?? {}) as Record<string, unknown>;
      for (const source of (action.sources as Array<Record<string, unknown>>) ?? []) {
        pushHit(hits, { title: source.title as string, url: source.url as string });
      }
    } else if (item?.type === 'message') {
      for (const part of (item.content as Array<Record<string, unknown>>) ?? []) {
        for (const note of (part.annotations as Array<Record<string, unknown>>) ?? []) {
          collectAnnotation(note);
        }
      }
    }
  };
  const collectAnnotation = (note: Record<string, unknown> | undefined) => {
    if (note?.type !== 'url_citation') return;
    pushHit(hits, { title: note.title as string, url: note.url as string });
  };
  for (const event of sseEvents(await response.text())) {
    const type = event.type;
    if (type === 'error' || type === 'response.failed') {
      const error = (event.error ?? (event.response as Record<string, unknown>)?.error) as
        | Record<string, unknown>
        | undefined;
      throw new Error(String(error?.message ?? event.message ?? 'response failed'));
    }
    if (type === 'response.output_text.delta') answer += String(event.delta ?? '');
    else if (type === 'response.output_text.annotation.added') {
      collectAnnotation(event.annotation as Record<string, unknown>);
    } else if (type === 'response.output_item.done') {
      collectItem(event.item as Record<string, unknown>);
    } else if (type === 'response.completed' || type === 'response.incomplete') {
      const output = (event.response as Record<string, unknown>)?.output;
      for (const item of (output as Array<Record<string, unknown>>) ?? []) collectItem(item);
    }
  }
  if (hits.length === 0) throw new NoSearchPerformed();
  return { source: 'openai', answer: answer.trim(), hits };
}

async function geminiSearch(
  query: string,
  model: SearchModel,
  auth: SearchAuth,
  signal: AbortSignal,
  fetchImpl: FetchLike
): Promise<SearchOutcome> {
  const response = await post(
    fetchImpl,
    `${trimBase(model.baseUrl)}/models/${model.id}:generateContent`,
    {
      signal,
      headers: {
        'content-type': 'application/json',
        ...model.headers,
        ...auth.headers,
        ...(auth.apiKey ? { 'x-goog-api-key': auth.apiKey } : {}),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt(query) }] }],
        tools: [{ google_search: {} }],
      }),
    }
  );
  const body = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: {
        webSearchQueries?: string[];
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  };
  const candidate = body.candidates?.[0];
  const grounding = candidate?.groundingMetadata;
  const hits: SearchHit[] = [];
  for (const chunk of grounding?.groundingChunks ?? []) {
    pushHit(hits, { title: chunk.web?.title, url: chunk.web?.uri });
  }
  if (hits.length === 0) throw new NoSearchPerformed();
  const answer = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
  return { source: 'gemini', answer: answer.trim(), hits };
}

async function exaSearch(
  query: string,
  signal: AbortSignal,
  fetchImpl: FetchLike
): Promise<SearchOutcome> {
  const response = await post(fetchImpl, EXA_MCP_URL, {
    signal,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'web_search_exa', arguments: { query, numResults: 8 } },
    }),
  });
  const raw = await response.text();
  const events = raw.trimStart().startsWith('{') ? [JSON.parse(raw)] : sseEvents(raw);
  const message = events.find((event) => 'result' in event || 'error' in event) as
    | { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: unknown }
    | undefined;
  const text = (message?.result?.content ?? []).map((part) => part.text ?? '').join('\n');
  if (!message?.result || message.result.isError || !text.trim()) {
    throw new Error(text.trim() || JSON.stringify(message?.error ?? 'empty response'));
  }
  const hits: SearchHit[] = [];
  for (const match of text.matchAll(/^Title: (.*)\nURL: (\S+)/gm)) {
    pushHit(hits, { title: match[1], url: match[2] });
  }
  // 限流等提示也以成功响应的文本返回，没有结果条目即视为失败
  if (hits.length === 0) throw new Error(text.trim().slice(0, 300));
  return { source: 'exa', answer: text.trim(), hits };
}

/**
 * 当前会话模型的原生搜索优先（复用会话凭据单独发一次请求），不支持或失败时降级到免 key 的 Exa MCP。
 * 网关静默丢弃搜索工具 / 明确拒绝时记入 unsupported，本会话后续直接跳过原生。
 */
export async function webSearch(
  query: string,
  context: { model?: SearchModel; auth: (model: SearchModel) => Promise<SearchAuth> },
  deps: WebSearchDeps,
  signal?: AbortSignal
): Promise<{ outcome: SearchOutcome; notes: string[] }> {
  const fetchImpl = deps.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const withTimeout = (ms: number) =>
    signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  const notes: string[] = [];
  const failures: string[] = [];
  const model = context.model;
  const kind = model ? nativeKind(model) : undefined;
  const key = model ? `${model.provider}\n${model.baseUrl}\n${model.id}` : '';
  if (model && kind && !deps.unsupported.has(key)) {
    try {
      const auth = await context.auth(model);
      const nativeSignal = withTimeout(NATIVE_TIMEOUT_MS);
      const outcome =
        kind === 'anthropic'
          ? await anthropicSearch(query, model, auth, nativeSignal, fetchImpl)
          : kind === 'gemini'
            ? await geminiSearch(query, model, auth, nativeSignal, fetchImpl)
            : await responsesSearch(query, model, auth, nativeSignal, fetchImpl, kind === 'codex');
      return { outcome, notes };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isUnsupported(error)) deps.unsupported.add(key);
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${kind}: ${reason}`);
      notes.push(`Native search via ${model.id} unavailable (${reason}); used Exa instead.`);
    }
  }
  try {
    return { outcome: await exaSearch(query, withTimeout(EXA_TIMEOUT_MS), fetchImpl), notes };
  } catch (error) {
    if (signal?.aborted) throw error;
    failures.push(`exa: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`Web search failed:\n${failures.map((line) => `- ${line}`).join('\n')}`);
}

export function formatSearchResult(query: string, outcome: SearchOutcome): string {
  const lines = [`Web search results for "${query}" (via ${outcome.source})`, UNTRUSTED_WEB_NOTICE];
  if (outcome.answer) lines.push('', outcome.answer.slice(0, MAX_ANSWER_CHARS));
  if (outcome.source !== 'exa' && outcome.hits.length > 0) {
    lines.push('', 'Sources:');
    outcome.hits.forEach((hit, index) => {
      lines.push(`${index + 1}. [${hit.title}](${hit.url})${hit.age ? ` (${hit.age})` : ''}`);
    });
  }
  lines.push(
    '',
    'Cite the sources you use as markdown links. Use web_fetch to read a page in full.'
  );
  return lines.join('\n');
}
