import type { ExtensionPluginManifest } from './manifest';

/** 用户同意时记录的授权范围；更新时与新清单比较，变大须重新同意 */
export interface PluginGrant {
  permissions: string[];
  fsRead: string[];
  fsWrite: string[];
  netDomains: string[];
  mcp: { name: string; command: string; args: string[]; envKeys: string[] }[];
  /** 允许调用的宿主 MCP 工具名；旧记录可能没有 */
  mcpTools?: string[];
  renderer: boolean;
}

export function grantOf(manifest: ExtensionPluginManifest): PluginGrant {
  return {
    permissions: [...manifest.permissions].sort(),
    fsRead: [...manifest.fs.read].sort(),
    fsWrite: [...manifest.fs.write].sort(),
    netDomains: [...manifest.net.domains].sort(),
    mcp: manifest.contributes.mcpServers.map((s) => ({
      name: s.name,
      command: s.command,
      args: [...s.args],
      envKeys: Object.keys(s.env).sort(),
    })),
    mcpTools: [...manifest.mcp.tools].sort(),
    renderer: manifest.renderer !== undefined,
  };
}

const covered = (path: string, scope: string[]) =>
  scope.some((root) => root === '.' || path === root || path.startsWith(`${root}/`));

export function grantExpands(previous: PluginGrant, next: PluginGrant): boolean {
  if (next.permissions.some((p) => !previous.permissions.includes(p))) return true;
  if (next.fsRead.some((p) => !covered(p, previous.fsRead))) return true;
  if (next.fsWrite.some((p) => !covered(p, previous.fsWrite))) return true;
  if (next.netDomains.some((d) => !previous.netDomains.includes(d))) return true;
  const key = (s: PluginGrant['mcp'][number]) =>
    JSON.stringify([s.name, s.command, s.args, s.envKeys]);
  const known = new Set(previous.mcp.map(key));
  if (next.mcp.some((s) => !known.has(key(s)))) return true;
  const tools = previous.mcpTools ?? [];
  if ((next.mcpTools ?? []).some((t) => !tools.includes(t))) return true;
  return next.renderer && !previous.renderer;
}
