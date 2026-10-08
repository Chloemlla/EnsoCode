import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { WebSearchChainEntry } from '@shared/webSearchChain';
import { formatFetchResult, type WebFetchDeps, webFetch } from './webFetch';
import { formatSearchResult, type SearchAuth, type SearchModel, webSearch } from './webSearch';

type Params = Record<string, unknown>;

const asRecord = (raw: unknown): Params =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Params) } : {};

function normalizeSearch(raw: unknown): Params {
  const args = asRecord(raw);
  if (typeof args.query === 'string') args.query = args.query.trim();
  return args;
}

function normalizeFetch(raw: unknown): Params {
  const args = asRecord(raw);
  if (typeof args.url === 'string') args.url = args.url.trim();
  if (typeof args.offset === 'string') {
    const parsed = Number(args.offset.trim());
    if (Number.isInteger(parsed) && parsed >= 0) args.offset = parsed;
    else delete args.offset;
  }
  return args;
}

const schema = (properties: Record<string, unknown>, required: string[]) =>
  ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }) as unknown as ToolDefinition['parameters'];

const text = (value: string) => [{ type: 'text' as const, text: value }];

/** 联网搜索与抓取。unsupported 按会话隔离：每个会话各自记住哪些模型端点不支持原生搜索 */
export function createWebTools(
  deps: Pick<WebFetchDeps, 'fetch' | 'lookup'> & {
    /** 全局 web_search 候选链（Main 推送的引用）；空 = 现行行为（只用会话模型） */
    chain?: () => readonly WebSearchChainEntry[];
  } = {}
): ToolDefinition[] {
  const unsupported = new Set<string>();
  const search: ToolDefinition = {
    name: 'web_search',
    label: 'Web search',
    description:
      "Search the public web for current information. Uses the session model's built-in web search when available, " +
      'otherwise a keyless search service. Returns a summary and source URLs; use web_fetch to read a source in full.',
    parameters: schema(
      { query: { type: 'string', description: 'Search query, specific and keyword-rich' } },
      ['query']
    ),
    prepareArguments: normalizeSearch as unknown as ToolDefinition['prepareArguments'],
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const query = normalizeSearch(params).query;
      if (typeof query !== 'string' || !query) throw new Error('query must be a non-empty string');
      // 链物化在调用时进行：modelRegistry 现取模型与凭证，auth.json 刷新即时生效
      const chainRefs = deps.chain?.() ?? [];
      const chainNotes: string[] = [];
      let candidates: SearchModel[] | undefined;
      if (chainRefs.length > 0) {
        candidates = [];
        for (const ref of chainRefs) {
          const found = ctx?.modelRegistry?.find(ref.providerId, ref.modelId) as
            | SearchModel
            | undefined;
          if (found) candidates.push(found);
          else chainNotes.push(`Candidate ${ref.providerId}/${ref.modelId} unavailable; skipped.`);
        }
      }
      const { outcome, notes } = await webSearch(
        query,
        {
          model: ctx?.model as SearchModel | undefined,
          candidates,
          auth: async (model): Promise<SearchAuth> => {
            const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model as never);
            if (!resolved.ok) throw new Error(resolved.error);
            const headers = Object.fromEntries(
              Object.entries(resolved.headers ?? {}).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            );
            return { apiKey: resolved.apiKey, headers };
          },
        },
        { unsupported, ...(deps.fetch ? { fetch: deps.fetch } : {}) },
        signal
      );
      return {
        content: text(formatSearchResult(query, outcome)),
        details: {
          source: outcome.source,
          sources: outcome.hits,
          notes: [...chainNotes, ...notes],
        },
      };
    },
  };
  const fetchTool: ToolDefinition = {
    name: 'web_fetch',
    label: 'Web fetch',
    description:
      'Fetch a public http(s) URL and return its main content as markdown (HTML) or text (JSON, XML, plain text). ' +
      'Private and local network addresses are refused. Long pages are paged; pass the returned offset to continue.',
    parameters: schema(
      {
        url: { type: 'string', description: 'Absolute http(s) URL' },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Character offset to continue a long page (default 0)',
        },
      },
      ['url']
    ),
    prepareArguments: normalizeFetch as unknown as ToolDefinition['prepareArguments'],
    async execute(_toolCallId, params, signal) {
      const args = normalizeFetch(params);
      if (typeof args.url !== 'string' || !args.url)
        throw new Error('url must be a non-empty string');
      const result = await webFetch(
        args.url,
        { ...(typeof args.offset === 'number' ? { offset: args.offset } : {}), signal },
        deps
      );
      return {
        content: text(formatFetchResult(result)),
        details: {
          url: result.url,
          status: result.status,
          ...(result.title ? { title: result.title } : {}),
          totalChars: result.totalChars,
        },
      };
    },
  };
  return [search, fetchTool];
}
