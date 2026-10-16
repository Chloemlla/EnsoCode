import { createHash } from 'node:crypto';

/** 主动续期提前量：worker 与 Main 同一口径，避免 worker 来请求了 Main 却判定「还没到期」 */
export const MCP_OAUTH_REFRESH_SKEW_MS = 60_000;

/** access token 指纹：worker↔Main 用它指认「被拒的那个 token」，明文不进事件与内存索引 */
export const mcpOAuthFingerprint = (accessToken: string): string =>
  createHash('sha256').update(accessToken).digest('hex').slice(0, 16);
