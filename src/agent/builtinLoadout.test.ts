import { describe, expect, it } from 'vitest';
import { enabledHotBuiltins, nextActiveToolNames } from './builtinLoadout';

describe('enabledHotBuiltins', () => {
  it('workflow 依赖 subagent；spawn 时定型的工具不在热切范围', () => {
    const enabled = enabledHotBuiltins(['subagent', 'isolated_sandbox']);
    expect(enabled.has('workflow')).toBe(false);
    expect(enabled.has('subagent')).toBe(false);
    expect(enabled.has('todo')).toBe(true);
    expect(enabled.has('isolated_sandbox')).toBe(false);
  });
});

describe('nextActiveToolNames', () => {
  const groups = new Map([
    ['todo', ['todo']],
    ['browser', ['browser_open', 'browser_click']],
    ['memory', ['memory_search']],
  ]);

  it('关掉的组移出，打开的组追加在末尾，其它工具（MCP、codemode）原序保留', () => {
    const next = nextActiveToolNames(
      ['read', 'todo', 'browser_open', 'browser_click', 'mcp__x', 'codemode'],
      groups,
      new Set(['todo', 'memory'])
    );
    expect(next).toEqual(['read', 'todo', 'mcp__x', 'codemode', 'memory_search']);
  });

  it('已经是目标状态时原样返回', () => {
    const active = ['read', 'todo', 'memory_search'];
    expect(nextActiveToolNames(active, groups, new Set(['todo', 'memory']))).toEqual(active);
  });
});
