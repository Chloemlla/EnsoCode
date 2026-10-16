# MCP OAuth 授权过一阵就失效（refresh 从未发生）

## 症状

远程 MCP 授权后能用，过一段时间（≈ access token 有效期，常见 1 小时）变成「需要授权」。
token 本身正常；access token 有效期长、或用固定 header 的 MCP 看不出问题。

## 根因

worker 侧把 `OAuthClientProvider` 交给 SDK transport，但它 `redirectUrl` 返回 `undefined`，
`clientInformation()` 也拿不到 Main 授权时 DCR 注册的 client。401 后 SDK 的 `auth()`：
先拿 `redirect_uris: []` 重新 DCR，再因无 redirectUrl 走非交互分支抛
`Either provider.prepareTokenRequest() or authorizationCode is required`，
refresh 分支从未执行。单测只测了「refresh 后回传」，没跑过真实 `auth()`，所以一直绿。

## 修法

refresh 只在 Main 做（参考 pi-desktop / oh-my-pi / ZCode）：

- 下发 worker 的只有 `McpOAuthAccess`（access token + 绝对过期时间），refresh_token 与 client 不出 Main。
- worker 不再给 transport 传 `authProvider`，由自定义 fetch 注入 Bearer；临期主动、401 被动
  经 `mcp-oauth-refresh` 请 Main 续期，重试一次。
- Main `refreshMcpOAuthAccess`：按 server 单飞 + 被拒 token 指纹比对（轮换型 refresh_token
  只能用一次）；复用存储的 client 与 RFC 8707 `resource`；`invalid_grant` 清 token、
  `invalid_client` 清整条，其余失败保留凭据；写回前比对 refresh_token，防覆盖期间的重新授权。
- 无 authProvider 时 SDK 的 401 是 `StreamableHTTPError { code: 401 }`，message 不含 401，判定要看 `code`。

## 回归防线

- `src/main/services/mcpOAuthRefresh.test.ts`：真实 pi-mcp discovery/refresh + 假授权服务器。
- `src/agent/mcp.test.ts`「McpManager OAuth access」：401 续期重试、并发单飞、临期续期、旧 token 不回退。
- `src/agent/supervisor.mcpOAuth.test.ts`、`src/shared/types/agent.test.ts`：IPC 往返与收窄。

## 相关代码

`src/agent/mcp.ts`（`OAuthAccess` / `remoteFetch`）、`src/main/services/mcpOAuthRefresh.ts`、
`src/main/services/mcpOAuthStore.ts`、`src/main/services/agentHost.ts`（拦截 `mcp-oauth-refresh`）。
