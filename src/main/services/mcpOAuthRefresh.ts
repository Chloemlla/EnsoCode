import {
  discoverOAuthServerInfo,
  type OAuthClientInformationMixed,
  OAuthError,
  refreshAuthorization,
  selectResource,
} from '@earendil-works/pi-mcp/oauth';
import { MCP_OAUTH_REFRESH_SKEW_MS, mcpOAuthFingerprint } from '@shared/mcpOAuth';
import type { McpOAuthRefreshResult } from '@shared/types/agent';
import type { McpServerEntry } from '@shared/types/assets';
import { resolveServerFromSettings, toStoredTokens } from './mcpOAuth';
import { getMcpOAuthStore, type McpOAuthStore } from './mcpOAuthStore';

export interface McpOAuthRefreshDeps {
  store: McpOAuthStore;
  resolveServer: (serverId: string) => Pick<McpServerEntry, 'url' | 'oauthMetadataUrl'> | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

const inflight = new Map<string, Promise<McpOAuthRefreshResult>>();

/**
 * MCP OAuth 续期只在 Main 做：refresh_token 不出 Main，同一 server 单飞，
 * 避免轮换型 refresh_token 被并发用两次而整组作废。
 * rejected = worker 被拒 token 的指纹；不给表示临期主动续期。
 */
export async function refreshMcpOAuthAccess(
  serverId: string,
  rejected?: string,
  overrides: Partial<McpOAuthRefreshDeps> = {}
): Promise<McpOAuthRefreshResult> {
  for (let running = inflight.get(serverId); running; running = inflight.get(serverId)) {
    const result = await running;
    // 并发的那次判定「无需刷新」却正是本次被拒的 token：轮到自己再来一次
    if (!rejected || !result.ok || mcpOAuthFingerprint(result.access.access_token) !== rejected) {
      return result;
    }
  }
  const deps: McpOAuthRefreshDeps = {
    store: getMcpOAuthStore(),
    resolveServer: resolveServerFromSettings,
    ...overrides,
  };
  const run = runRefresh(serverId, rejected, deps).finally(() => inflight.delete(serverId));
  inflight.set(serverId, run);
  return run;
}

const unauthorized = (error: string): McpOAuthRefreshResult => ({
  ok: false,
  unauthorized: true,
  error,
});

function current(store: McpOAuthStore, serverId: string): McpOAuthRefreshResult {
  const access = store.access(serverId);
  return access ? { ok: true, access } : unauthorized('MCP server is not authorized.');
}

async function runRefresh(
  serverId: string,
  rejected: string | undefined,
  deps: McpOAuthRefreshDeps
): Promise<McpOAuthRefreshResult> {
  const { store } = deps;
  const record = store.record(serverId);
  const tokens = record?.tokens;
  if (!record || !tokens?.access_token) return unauthorized('MCP server is not authorized.');
  const now = (deps.now ?? Date.now)();
  const stillValid = rejected
    ? mcpOAuthFingerprint(tokens.access_token) !== rejected
    : record.expiresAt === undefined || now < record.expiresAt - MCP_OAUTH_REFRESH_SKEW_MS;
  if (stillValid) return current(store, serverId);
  const client = record.clientInformation as OAuthClientInformationMixed | undefined;
  if (!tokens.refresh_token || !client?.client_id) {
    return unauthorized('MCP authorization expired and cannot be refreshed.');
  }
  const server = deps.resolveServer(serverId);
  const serverUrl = server?.url ?? record.serverUrl;
  if (!serverUrl) return unauthorized('MCP server not found.');
  // 刷新期间用户可能重新授权或撤销：只在凭据未被换掉时落结果
  const unchanged = () => store.tokens(serverId)?.refresh_token === tokens.refresh_token;
  try {
    const metadataUrl = server?.oauthMetadataUrl?.trim();
    const info = await discoverOAuthServerInfo(serverUrl, {
      ...(metadataUrl ? { authorizationServerMetadataUrl: new URL(metadataUrl) } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    const refreshed = await refreshAuthorization(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientInformation: client,
      resource: selectResource(serverUrl, info.resourceMetadata),
      refreshToken: tokens.refresh_token,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    if (unchanged()) {
      // 响应不带 scope 时沿用原授权 scope（RFC 6749 §6）
      store.saveTokens(
        serverId,
        toStoredTokens({ ...refreshed, scope: refreshed.scope ?? tokens.scope }),
        serverUrl
      );
    }
    return current(store, serverId);
  } catch (error) {
    if (!unchanged()) return current(store, serverId);
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    if (error instanceof OAuthError && error.code === 'invalid_grant') {
      store.clearTokens(serverId);
      return unauthorized(reason);
    }
    if (
      error instanceof OAuthError &&
      (error.code === 'invalid_client' || error.code === 'unauthorized_client')
    ) {
      store.clear(serverId);
      return unauthorized(reason);
    }
    console.warn(`[mcp-oauth] refresh failed for ${serverId}: ${reason}`);
    return { ok: false, unauthorized: false, error: reason };
  }
}
