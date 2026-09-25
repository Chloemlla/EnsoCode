import { describe, expect, it } from 'vitest';
import { parseMcpToolName } from './mcpToolName';

describe('parseMcpToolName', () => {
  it('splits server slug and tool name', () => {
    expect(parseMcpToolName('mcp__fast-context__fast_context_search')).toEqual({
      server: 'fast-context',
      tool: 'fast_context_search',
    });
  });

  it('keeps double underscores inside the tool name', () => {
    expect(parseMcpToolName('mcp__srv__a__b')).toEqual({ server: 'srv', tool: 'a__b' });
  });

  it('returns null for non-MCP or malformed names', () => {
    expect(parseMcpToolName('bash')).toBeNull();
    expect(parseMcpToolName('mcp_foo_bar')).toBeNull();
    expect(parseMcpToolName('mcp__srv')).toBeNull();
    expect(parseMcpToolName('mcp____tool')).toBeNull();
    expect(parseMcpToolName('mcp__srv__')).toBeNull();
  });
});
