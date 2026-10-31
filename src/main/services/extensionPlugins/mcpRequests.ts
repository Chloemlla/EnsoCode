import { randomUUID } from 'node:crypto';
import type { AgentCommand, AgentWorkerEvent, McpServerSpawnConfig } from '@shared/types/agent';
import type { McpToolInfo } from './gate';
import { pluginError } from './process';

type PluginMcpCommand = Extract<AgentCommand, { type: `plugin-mcp-${string}` }>;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** Main 侧挂起表：插件的宿主 MCP 请求经 worker 执行，按 requestId 结算 */
export class PluginMcpRequests {
  private readonly pending = new Map<string, Pending>();

  constructor(
    /** 发给 worker；worker 不可用返回 false */
    private readonly post: (command: PluginMcpCommand) => boolean,
    private readonly timeoutMs = 120_000
  ) {}

  list(servers: McpServerSpawnConfig[], signal: AbortSignal): Promise<McpToolInfo[]> {
    return this.request(
      (requestId) => ({ type: 'plugin-mcp-list', requestId, servers }),
      signal
    ) as Promise<McpToolInfo[]>;
  }

  call(
    servers: McpServerSpawnConfig[],
    server: string,
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<{ content: string; isError: boolean }> {
    return this.request(
      (requestId) => ({ type: 'plugin-mcp-call', requestId, servers, server, tool, args }),
      signal
    ) as Promise<{ content: string; isError: boolean }>;
  }

  settle(event: AgentWorkerEvent): boolean {
    if (event.type !== 'plugin-mcp-result') return false;
    const entry = this.pending.get(event.requestId);
    if (entry) {
      if (event.ok) entry.resolve(event.value);
      else entry.reject(pluginError('MCP_ERROR', event.error));
    }
    return true;
  }

  failAll(message: string): void {
    for (const entry of [...this.pending.values()]) entry.reject(pluginError('MCP_ERROR', message));
  }

  private request(
    build: (requestId: string) => PluginMcpCommand,
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) return Promise.reject(pluginError('ABORTED', '调用已取消'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const cancelRemote = () => this.post({ type: 'plugin-mcp-cancel', requestId });
      const onAbort = () => {
        cancelRemote();
        finish(() => reject(pluginError('ABORTED', '调用已取消')));
      };
      const timer = setTimeout(() => {
        cancelRemote();
        finish(() => reject(pluginError('TIMEOUT', `MCP 调用超时（${this.timeoutMs}ms）`)));
      }, this.timeoutMs);
      const finish = (settle: () => void) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        settle();
      };
      this.pending.set(requestId, {
        resolve: (value) => finish(() => resolve(value)),
        reject: (error) => finish(() => reject(error)),
      });
      signal.addEventListener('abort', onAbort, { once: true });
      if (!this.post(build(requestId)))
        finish(() => reject(pluginError('UNSUPPORTED', 'Agent 进程不可用，无法调用 MCP')));
    });
  }
}
