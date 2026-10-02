import { createHash } from 'node:crypto';

/** 与 pi createMcpToolName 一致：工具名上限 64，超长或撞名时带 8 位哈希 */
const MAX_TOOL_NAME_LENGTH = 64;

const shortHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 8);

const serverSlug = (serverName: string): string =>
  serverName.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') ||
  `server_${shortHash(serverName)}`;

/** `mcp__<server>`：只含 [A-Za-z0-9_]，即 codemode 脚本里的标识符（同 pi 0.99.2 / Codex） */
export const mcpNamespaceName = (serverName: string): string => `mcp__${serverSlug(serverName)}`;

function toolName(serverName: string, tool: string, taken: boolean): string {
  const name = `${mcpNamespaceName(serverName)}__${tool.replace(/[^A-Za-z0-9_]/g, '_')}`;
  if (name.length <= MAX_TOOL_NAME_LENGTH && !taken) return name;
  const hash = shortHash(`${serverName}\0${tool}`);
  return `${name.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

/** 一个 server 的工具名：归一化后撞名的全部带哈希，谁拿原名不取决于列表顺序 */
export function assignMcpToolNames(serverName: string, tools: readonly string[]): string[] {
  const plain = tools.map((tool) => toolName(serverName, tool, false));
  return tools.map((tool, index) =>
    toolName(serverName, tool, plain.indexOf(plain[index]) !== plain.lastIndexOf(plain[index]))
  );
}

/** 命名空间相同（如 a-b 与 a_b）的 server 会共用工具名，保留先出现的，其余拒绝 */
export function partitionMcpNamespaces<T extends { name: string }>(
  servers: readonly T[]
): { kept: T[]; conflicts: { server: T; clash: string }[] } {
  const owners = new Map<string, string>();
  const kept: T[] = [];
  const conflicts: { server: T; clash: string }[] = [];
  for (const server of servers) {
    const namespace = mcpNamespaceName(server.name);
    const owner = owners.get(namespace);
    if (owner !== undefined && owner !== server.name) {
      conflicts.push({ server, clash: owner });
      continue;
    }
    owners.set(namespace, server.name);
    kept.push(server);
  }
  return { kept, conflicts };
}
