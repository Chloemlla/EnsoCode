import { describe, expect, it } from 'vitest';
import { assignMcpToolNames, mcpNamespaceName, partitionMcpNamespaces } from './mcpNames';

describe('mcpNamespaceName', () => {
  it('非 [A-Za-z0-9_] 字符统一成 _，作为 codemode 标识符可直接调用', () => {
    expect(mcpNamespaceName('my-docs')).toBe('mcp__my_docs');
    expect(mcpNamespaceName('my docs.v2')).toBe('mcp__my_docs_v2');
    expect(mcpNamespaceName('-x-')).toBe('mcp__x');
  });

  it('全是非 ASCII 的服务器名也得到稳定且合法的命名空间', () => {
    const name = mcpNamespaceName('飞书');
    expect(name).toMatch(/^mcp__[A-Za-z0-9_]+$/);
    expect(name).toBe(mcpNamespaceName('飞书'));
    expect(name).not.toBe(mcpNamespaceName('钉钉'));
  });
});

describe('assignMcpToolNames', () => {
  it('普通工具名只做字符归一化', () => {
    expect(assignMcpToolNames('my-docs', ['search', 'get-page'])).toEqual([
      'mcp__my_docs__search',
      'mcp__my_docs__get_page',
    ]);
  });

  it('归一化后撞名的工具全部带哈希后缀，与顺序无关', () => {
    const forward = assignMcpToolNames('s', ['read-file', 'read_file', 'other']);
    const backward = assignMcpToolNames('s', ['read_file', 'read-file', 'other']);
    expect(forward[2]).toBe('mcp__s__other');
    expect(forward[0]).toMatch(/^mcp__s__read_file_[0-9a-f]{8}$/);
    expect(forward[1]).toMatch(/^mcp__s__read_file_[0-9a-f]{8}$/);
    expect(forward[0]).not.toBe(forward[1]);
    expect(backward).toEqual([forward[1], forward[0], forward[2]]);
  });

  it('超过 64 字符时截断并带哈希，结果唯一', () => {
    const long = 'x'.repeat(80);
    const [a, b] = assignMcpToolNames('s', [`${long}a`, `${long}b`]);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).toMatch(/_[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe('partitionMcpNamespaces', () => {
  it('命名空间相同的后一个服务器被拒绝并说明冲突对象', () => {
    const servers = [{ name: 'a-b' }, { name: 'a_b' }, { name: 'c' }];
    const { kept, conflicts } = partitionMcpNamespaces(servers);
    expect(kept.map((server) => server.name)).toEqual(['a-b', 'c']);
    expect(conflicts).toEqual([{ server: servers[1], clash: 'a-b' }]);
  });
});
