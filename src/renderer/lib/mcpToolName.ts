/** 拆分 `mcp__<server>__<tool>`（见 src/agent/mcp.ts）；非 MCP 工具返回 null */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1], tool: match[2] } : null;
}
