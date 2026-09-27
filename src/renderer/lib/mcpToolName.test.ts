import { describe, expect, it } from 'vitest';
import { parseMcpToolName, unwrapMcpProxyCall } from './mcpToolName';

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

describe('unwrapMcpProxyCall', () => {
  it('passes non-proxy tools through', () => {
    const args = { path: 'a.ts' };
    expect(unwrapMcpProxyCall('read', args)).toEqual({ name: 'read', args });
  });

  it('unwraps call into the real tool name and inner arguments', () => {
    expect(
      unwrapMcpProxyCall('mcp', {
        action: 'call',
        tool: 'mcp__github__search_issues',
        arguments: { query: 'bug' },
      })
    ).toEqual({ name: 'mcp__github__search_issues', args: { query: 'bug' } });
  });

  it('tolerates missing prefix with server, name alias, JSON string arguments and args text', () => {
    expect(
      unwrapMcpProxyCall('mcp', {
        action: 'call',
        server: 'github',
        tool: 'search_issues',
        arguments: '{"query":"bug"}',
      })
    ).toEqual({ name: 'mcp__github__search_issues', args: { query: 'bug' } });
    expect(unwrapMcpProxyCall('mcp', '{"action":"call","name":"mcp__s__t"}')).toEqual({
      name: 'mcp__s__t',
      args: {},
    });
  });

  it('summarizes list and describe', () => {
    expect(unwrapMcpProxyCall('mcp', { action: 'list' })).toMatchObject({
      name: 'mcp',
      summary: 'list',
    });
    expect(unwrapMcpProxyCall('mcp', { action: 'list', server: 'github' })).toMatchObject({
      name: 'mcp',
      summary: 'github',
    });
    expect(
      unwrapMcpProxyCall('mcp', { action: 'describe', tool: 'mcp__github__search_issues' })
    ).toMatchObject({ name: 'mcp', summary: 'mcp__github__search_issues' });
  });

  it('keeps unresolvable calls on the proxy', () => {
    const args = { action: 'call', tool: 'search_issues' };
    expect(unwrapMcpProxyCall('mcp', args)).toEqual({ name: 'mcp', args });
    expect(unwrapMcpProxyCall('mcp', 'not json')).toEqual({ name: 'mcp', args: 'not json' });
  });
});
