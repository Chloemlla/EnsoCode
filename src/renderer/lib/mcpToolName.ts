/** 拆分 `mcp__<server>__<tool>`（见 src/agent/mcp.ts）；非 MCP 工具返回 null */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1], tool: match[2] } : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function proxyToolName(record: Record<string, unknown>): string | undefined {
  const tool = [record.tool, record.name].find((v) => typeof v === 'string' && v);
  if (typeof tool !== 'string') return undefined;
  if (tool.startsWith('mcp__') || typeof record.server !== 'string' || !record.server) return tool;
  return `mcp__${record.server}__${tool}`;
}

/** `mcp` 按需代理：call 解包为真实工具与内层参数，list / describe 给出摘要；其余原样返回 */
export function unwrapMcpProxyCall(
  name: string,
  args: unknown
): { name: string; args: unknown; summary?: string } {
  if (name !== 'mcp') return { name, args };
  const record = parseJsonRecord(args);
  if (!record) return { name, args };
  const tool = proxyToolName(record);
  if (record.action === 'list') {
    return {
      name,
      args,
      summary: typeof record.server === 'string' && record.server ? record.server : 'list',
    };
  }
  if (record.action === 'describe' && tool) return { name, args, summary: tool };
  if (record.action === 'call' && tool && parseMcpToolName(tool)) {
    return { name: tool, args: parseJsonRecord(record.arguments) ?? {} };
  }
  return { name, args };
}
