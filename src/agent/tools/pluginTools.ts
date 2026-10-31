import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { PluginToolResult } from '@shared/extensionPlugins/protocol';
import type { PluginToolDescriptor } from '@shared/extensionPlugins/types';
import type { SessionIdentity } from '@shared/types/agent';

export interface PluginToolInvokeRequest {
  identity: SessionIdentity;
  requestId: string;
  toolName: string;
  args: unknown;
}

export interface PluginToolInvokeResult {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface Pending {
  settle(outcome: unknown, cancelRemote?: boolean): void;
}

/** Main 侧 60 秒超时之外的余量 */
const DEFAULT_TIMEOUT_MS = 70_000;

/**
 * worker ↔ Main 的插件工具挂起表：`plugin-tool-invoke` 上抛，`plugin-tool-result` 回落；
 * abort / 超时 / shutdown 本地 fail-closed，并经 `plugin-tool-cancel` 让 Main 取消插件调用。
 */
export class PluginToolInvoker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly identity: SessionIdentity,
    private readonly emit: (request: PluginToolInvokeRequest) => void,
    private readonly options: { timeoutMs?: number; emitCancel?: (requestId: string) => void } = {}
  ) {}

  invoke(toolName: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error('Plugin tool aborted'));
    const requestId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(
      () => settle(new Error(`Plugin tool ${toolName} timed out after ${timeoutMs}ms`), true),
      timeoutMs
    );
    const onAbort = () => settle(new Error('Plugin tool aborted'), true);
    const settle = (outcome: unknown, cancelRemote = false) => {
      if (!this.pending.delete(requestId)) return;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (cancelRemote) {
        try {
          this.options.emitCancel?.(requestId);
        } catch {
          // 会话已释放：Main 侧由 worker 退出兜底取消
        }
      }
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    this.pending.set(requestId, { settle });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      this.emit({ identity: this.identity, requestId, toolName, args });
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  resolve(result: PluginToolInvokeResult): boolean {
    const entry = this.pending.get(result.requestId);
    if (!entry) return false;
    entry.settle(result.ok ? result.result : new Error(result.error || 'Plugin tool failed'));
    return true;
  }

  cancelAll(reason = 'Plugin tool cancelled'): void {
    for (const entry of [...this.pending.values()]) entry.settle(new Error(reason), true);
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

export function createPluginTools(
  descriptors: PluginToolDescriptor[],
  invoker: Pick<PluginToolInvoker, 'invoke'>
): ToolDefinition[] {
  return descriptors.map((descriptor) => ({
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.description,
    parameters: descriptor.parameters as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params, signal) {
      const result = (await invoker.invoke(
        descriptor.name,
        params ?? {},
        signal
      )) as PluginToolResult;
      return {
        content: [
          {
            type: 'text' as const,
            text: typeof result?.content === 'string' ? result.content : '',
          },
        ],
        details: result?.details,
      };
    },
  }));
}
