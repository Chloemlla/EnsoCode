import { describe, expect, it } from 'vitest';
import { summarizeSubagentToolArgs } from './subagentToolSummary';

describe('summarizeSubagentToolArgs', () => {
  it('搜索工具优先显示 pattern', () => {
    expect(
      summarizeSubagentToolArgs('grep', '{"path":"src","query":"次选","pattern":"目标"}')
    ).toBe('目标');
  });

  it('read 工具优先显示 path', () => {
    expect(summarizeSubagentToolArgs('read', '{"query":"次选","path":"src/app.tsx"}')).toBe(
      'src/app.tsx'
    );
  });

  it('bash 工具显示单行 command', () => {
    expect(summarizeSubagentToolArgs('bash', '{"command":"pnpm test\\n--runInBand"}')).toBe(
      'pnpm test --runInBand'
    );
  });

  it('未知工具从通用字段取安全摘要', () => {
    expect(summarizeSubagentToolArgs('custom_tool', '{"description":"检查结果"}')).toBe('检查结果');
  });

  it.each([
    ['', ''],
    ['   ', ''],
    ['{}', ''],
    ['null', ''],
    ['[]', '[]'],
    ['["a",2]', '["a",2]'],
  ])('空值或数组不会崩溃：%j', (input, expected) => {
    expect(summarizeSubagentToolArgs('unknown', input)).toBe(expected);
  });

  it('坏 JSON 与截断 JSON 回退为单行并限制长度', () => {
    expect(summarizeSubagentToolArgs('read', '{"path": "src/a.ts"')).toBe('{"path": "src/a.ts"');
    const summary = summarizeSubagentToolArgs('unknown', `not json\n${'x'.repeat(300)}`);
    expect(summary).toMatch(/^not json x+…$/);
    expect(summary.length).toBeLessThanOrEqual(121);
  });

  it('mcp 代理调用按内层参数与动作摘要', () => {
    expect(
      summarizeSubagentToolArgs(
        'mcp',
        '{"action":"call","tool":"mcp__s__search","arguments":{"query":"bug"}}'
      )
    ).toBe('bug');
    expect(summarizeSubagentToolArgs('mcp', '{"action":"list","server":"s"}')).toBe('s');
    expect(summarizeSubagentToolArgs('mcp', '{"action":"describe","tool":"mcp__s__t"}')).toBe(
      'mcp__s__t'
    );
  });
});
