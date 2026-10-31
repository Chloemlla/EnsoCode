import type { SessionIdentity } from '@shared/types/agent';
import {
  projectDisabledBuiltinTools,
  resolveDisabledBuiltinTools,
} from '@shared/types/builtinTools';

type ToolSettings = { disabledBuiltinTools?: unknown; projects?: unknown } | undefined;

/** 会话的有效禁用列表：设置（项目覆盖优先）+ 会话固定禁用 + 平台不支持的 computer */
export function sessionDisabledTools(
  state: ToolSettings,
  projectId: string | undefined,
  extra: readonly string[],
  computerSupported: boolean
): string[] {
  const disabled = resolveDisabledBuiltinTools(state?.disabledBuiltinTools, {
    disabledBuiltinTools: projectDisabledBuiltinTools(state?.projects, projectId),
  });
  for (const id of extra) if (!disabled.includes(id)) disabled.push(id);
  if (!computerSupported && !disabled.includes('computer')) disabled.push('computer');
  return disabled;
}

interface Scope {
  identity: SessionIdentity;
  projectId?: string;
  extra: readonly string[];
  sent: string;
}

/** 记录活着的父会话的工具口径，设置变化时只产出结果变了的推送 */
export class BuiltinToolScopes {
  private readonly scopes = new Map<string, Scope>();

  remember(
    identity: SessionIdentity,
    projectId: string | undefined,
    extra: readonly string[],
    disabled: readonly string[]
  ): void {
    this.scopes.set(identity.sessionId, {
      identity,
      ...(projectId ? { projectId } : {}),
      extra: [...extra],
      sent: JSON.stringify(disabled),
    });
  }

  forget(sessionId: string): void {
    this.scopes.delete(sessionId);
  }

  changes(
    state: ToolSettings,
    computerSupported: boolean
  ): Array<{ identity: SessionIdentity; disabledTools: string[] }> {
    const out: Array<{ identity: SessionIdentity; disabledTools: string[] }> = [];
    for (const scope of this.scopes.values()) {
      const disabledTools = sessionDisabledTools(
        state,
        scope.projectId,
        scope.extra,
        computerSupported
      );
      const key = JSON.stringify(disabledTools);
      if (key === scope.sent) continue;
      scope.sent = key;
      out.push({ identity: scope.identity, disabledTools });
    }
    return out;
  }
}
