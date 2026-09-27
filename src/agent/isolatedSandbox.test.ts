import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  createIsolatedSandboxTool,
  guestCallableName,
  looksLikeShellCommand,
} from './isolatedSandbox';

function mockTool(name: string, execute: (id: string, params: unknown) => unknown): ToolDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object' },
    execute,
  } as unknown as ToolDefinition;
}

async function run(
  code: string,
  tools: ToolDefinition[] = [],
  store?: Map<string, unknown>
): Promise<{ text: string; details: Record<string, unknown> }> {
  const tool = createIsolatedSandboxTool({ getTools: () => tools, store });
  const result = await tool.execute('exec-1', { code }, undefined, undefined, {} as never);
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('expected text');
  return {
    text: first.text,
    details: (result.details ?? {}) as Record<string, unknown>,
  };
}

describe('looksLikeShellCommand', () => {
  it('拒绝可识别的 shell，放过 JS', () => {
    expect(looksLikeShellCommand('ls -la')).toBe(true);
    expect(looksLikeShellCommand('git status')).toBe(true);
    expect(looksLikeShellCommand('const x = 1; return x')).toBe(false);
    expect(looksLikeShellCommand('await read({ path: "a.ts" })')).toBe(false);
    expect(looksLikeShellCommand('ls({ path: "." })')).toBe(false);
  });
});

describe('createIsolatedSandboxTool', () => {
  it('嵌套工具的字符串参数原样下传，不收成空对象', async () => {
    let received: unknown;
    const patch = mockTool('apply_patch', async (_id, params) => {
      received = params;
      return { content: [{ type: 'text', text: 'ok' }], details: {} };
    });
    const payload = '*** Begin Patch\n*** Add File: a.txt\n+a\n*** End Patch';
    const result = await run(`return await apply_patch(${JSON.stringify(payload)});`, [patch]);
    expect(received).toBe(payload);
    expect(result.details.status).toBe('completed');
  });

  it('整段 apply_patch 信封拒绝执行，JS 里提到信封不拦截', async () => {
    const tool = createIsolatedSandboxTool({ getTools: () => [] });
    const envelope = '*** Begin Patch\n*** Add File: a.txt\n+a\n*** End Patch';
    await expect(
      tool.execute('exec-1', { code: envelope }, undefined, undefined, {} as never)
    ).rejects.toThrow(/not an apply_patch document/);
    await expect(
      tool.execute(
        'exec-1',
        { code: '*** Begin Patch ***\n*** Add File: a.txt\n+a\n*** End Patch ***' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/not an apply_patch document/);
    const mentioned = await run(
      'const input = `*** Begin Patch\\n*** Add File: a.txt\\n+a\\n*** End Patch`; return input.length;'
    );
    expect(mentioned.details.status).toBe('completed');
    expect(mentioned.details.value).toBe(envelope.length);
  });

  it('prompt 保留约束且不含 hashline snapshot 说明', () => {
    const tool = createIsolatedSandboxTool({ getTools: () => [] });
    const text = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join(
      '\n'
    );
    expect(text).toMatch(/prefer exec/i);
    expect(text).not.toMatch(/3\+ similar guest calls/i);
    expect(text).toMatch(/filter/i);
    expect(text).toMatch(/loop/i);
    expect(text).toMatch(/chain/i);
    expect(text).toMatch(/3\+ independent similar calls/i);
    expect(text).toMatch(/call the tool directly/i);
    expect(text).toMatch(/call\("mcp__/);
    expect(text).toMatch(/MCP/i);
    expect(text).toMatch(/apply_patch/i);
    expect(text).toMatch(/explore unknown code/i);
    expect(text).toMatch(/Do not wrap a single call/i);
    expect(text).not.toMatch(/parent hashline snapshot/i);
    expect(text).toMatch(/JSON-serialized and truncated/i);
    expect(text).not.toMatch(/Hashline headers require the Hashline setting/i);
    expect(text).toMatch(/No console/i);
    expect(text).toMatch(/isError: true/i);
    expect(text).toMatch(/listTools/i);
    expect(tool.promptSnippet).toMatch(/Do not spawn a subagent for this/i);
  });

  it('guestCallableName 把 MCP 名收成合法标识符且不撞名', () => {
    const taken = new Set<string>();
    expect(guestCallableName('mcp.foo-bar', taken)).toBe('mcp_foo_bar');
    expect(guestCallableName('mcp.foo-bar', taken)).toBe('mcp_foo_bar_2');
    expect(guestCallableName('123watch', taken)).toBe('tool_123watch');
    taken.add('JSON');
    expect(guestCallableName('JSON', taken)).toBe('JSON_2');
  });

  it('在 QuickJS 里求值，guest 没有 fs/require', async () => {
    const result = await run(`
      if (typeof require !== "undefined") throw new Error("require leaked");
      if (typeof process !== "undefined") throw new Error("process leaked");
      return 1 + 2;
    `);
    expect(result.details.status).toBe('completed');
    expect(result.details.value).toBe(3);
  });

  it('guest 可调用写工具，走传入的 execute', async () => {
    const writes: unknown[] = [];
    const write = mockTool('write', async (_id, params) => {
      writes.push(params);
      return { content: [{ type: 'text', text: 'ok' }], details: { ok: true } };
    });
    const result = await run(
      `
        const out = await write({ path: "a.ts", content: "x" });
        return out.details;
      `,
      [write]
    );
    expect(writes).toEqual([{ path: 'a.ts', content: 'x' }]);
    expect(result.details.value).toEqual({ ok: true });
  });

  it('写工具失败可 catch，先前副作用不回滚', async () => {
    const writes: string[] = [];
    const write = mockTool('write', async (_id, params) => {
      const path = (params as { path: string }).path;
      writes.push(path);
      if (path === 'b.ts') throw new Error('disk full');
      return { content: [{ type: 'text', text: 'ok' }], details: {} };
    });
    const result = await run(
      `
        const a = await write({ path: "a.ts", content: "1" });
        const b = await write({ path: "b.ts", content: "2" });
        return { a: a.isError, b: b.isError, bText: b.content };
      `,
      [write]
    );
    expect(writes).toEqual(['a.ts', 'b.ts']);
    expect(result.details.value).toEqual({
      a: false,
      b: true,
      bText: 'disk full',
    });
  });

  it('拒绝递归 exec 和 shell 形态输入', async () => {
    const nested = mockTool('exec', async () => {
      throw new Error('should not run');
    });
    const recursive = await run('await exec({ code: "return 1" })', [nested]);
    expect(recursive.details.status).toBe('failed');
    expect(recursive.text).toMatch(/not defined|not available/i);

    await expect(run('ls -la src')).rejects.toThrow(/javascript/i);
  });

  it('Promise.all 并行调两个工具', async () => {
    let live = 0;
    let maxLive = 0;
    const read = mockTool('read', async (_id, params) => {
      live += 1;
      maxLive = Math.max(maxLive, live);
      await new Promise((resolve) => setTimeout(resolve, 40));
      live -= 1;
      return {
        content: [{ type: 'text', text: String((params as { path: string }).path) }],
        details: {},
      };
    });
    const result = await run(
      `
        const [a, b] = await Promise.all([
          read({ path: "a.ts" }),
          read({ path: "b.ts" }),
        ]);
        return [a.content, b.content];
      `,
      [read]
    );
    expect(maxLive).toBe(2);
    expect(result.details.value).toEqual(['a.ts', 'b.ts']);
  });

  it('apply_patch partial 即使工具 execute 返回未标错，guest 仍收到 isError 且保留 details', async () => {
    const patch = mockTool('apply_patch', async () => ({
      content: [{ type: 'text', text: 'one file applied, one failed' }],
      details: {
        kind: 'apply_patch',
        status: 'partial',
        applied: ['a.ts'],
        failed: ['b.ts'],
      },
    }));
    const result = await run(
      `const out = await apply_patch({ patch: "x" }); return { error: out.isError, details: out.details };`,
      [patch]
    );
    expect(result.details.value).toEqual({
      error: true,
      details: {
        kind: 'apply_patch',
        status: 'partial',
        applied: ['a.ts'],
        failed: ['b.ts'],
      },
    });
  });

  it('工具失败 resolve 为 isError，不拖垮 Promise.all', async () => {
    const read = mockTool('read', async (_id, params) => {
      const path = (params as { path: string }).path;
      if (path === 'missing') throw new Error('ENOENT');
      return { content: [{ type: 'text', text: 'ok' }], details: {} };
    });
    const result = await run(
      `
        const [ok, bad] = await Promise.all([
          read({ path: "a.ts" }),
          read({ path: "missing" }),
        ]);
        return { ok: ok.isError, bad: bad.isError, text: bad.content };
      `,
      [read]
    );
    expect(result.details.status).toBe('completed');
    expect(result.details.value).toEqual({ ok: false, bad: true, text: 'ENOENT' });
  });

  it('store/load 跨两次 exec 活着', async () => {
    const store = new Map<string, unknown>();
    await run(`store("n", 3); return load("n");`, [], store);
    const second = await run(`return load("n") + 1;`, [], store);
    expect(second.details.value).toBe(4);
  });

  it('连字符工具名可在 guest 里当标识符调用', async () => {
    const calls: unknown[] = [];
    const tool = mockTool('mcp.list-shipments', async (_id, params) => {
      calls.push(params);
      return { content: [{ type: 'text', text: 'ok' }], details: { rows: [1] } };
    });
    const result = await run(`return (await mcp_list_shipments({ paid: false })).details;`, [tool]);
    expect(calls).toEqual([{ paid: false }]);
    expect(result.details.value).toEqual({ rows: [1] });
  });

  it('write 内容含 import 语句不被预检误杀', async () => {
    const writes: unknown[] = [];
    const write = mockTool('write', async (_id, params) => {
      writes.push(params);
      return { content: [{ type: 'text', text: 'ok' }], details: {} };
    });
    const result = await run(
      `await write({ path: "a.ts", content: "import { x } from './x'\\n" }); return "ok";`,
      [write]
    );
    expect(result.details.status).toBe('completed');
    expect(writes).toHaveLength(1);
  });

  it('store(undefined) 之后 load 得到 undefined', async () => {
    const store = new Map<string, unknown>();
    const result = await run(`store("k", undefined); return load("k");`, [], store);
    expect(result.details.value).toBeUndefined();
  });

  it('subagent/coworker 不注入 guest，catalog 也搜不到', async () => {
    const sub = mockTool('subagent', async () => {
      throw new Error('should not run');
    });
    const cow = mockTool('coworker', async () => {
      throw new Error('should not run');
    });
    const ping = mockTool('read', async () => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    }));
    const result = await run(
      `
        return {
          sub: typeof subagent,
          cow: typeof coworker,
          hits: (await catalog.search("sub")).length,
          names: catalog.all().length,
        };
      `,
      [sub, cow, ping]
    );
    expect(result.details.value).toEqual({
      sub: 'undefined',
      cow: 'undefined',
      hits: 0,
      names: 1,
    });
  });

  it('Promise.all 超出预算在 enqueue 时失败，且不执行已入队调用', async () => {
    let ran = 0;
    const read = mockTool('read', async () => {
      ran += 1;
      return {
        content: [{ type: 'text', text: 'ok' }],
        details: {},
      };
    });
    const result = await run(
      `
        await Promise.all(Array.from({ length: 70 }, (_, i) => read({ path: String(i) })));
        return "ok";
      `,
      [read]
    );
    expect(result.details.status).toBe('failed');
    expect(result.text).toMatch(/budget/i);
    expect(ran).toBe(0);
  });

  it('先 await 一次再超预算，只执行第一次调用', async () => {
    let ran = 0;
    const read = mockTool('read', async () => {
      ran += 1;
      return {
        content: [{ type: 'text', text: 'ok' }],
        details: {},
      };
    });
    const result = await run(
      `
        await read({ path: "first" });
        await Promise.all(Array.from({ length: 70 }, (_, i) => read({ path: String(i) })));
        return "ok";
      `,
      [read]
    );
    expect(result.details.status).toBe('failed');
    expect(result.text).toMatch(/budget/i);
    expect(ran).toBe(1);
  });

  it('console.log 提示用 return，listTools 列出可调用名', async () => {
    const read = mockTool('read', async () => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    }));
    const listed = await run(`return listTools();`, [read]);
    expect(listed.details.value).toEqual([{ name: 'read', tool: 'read' }]);
    const logged = await run(`console.log("hi"); return 1;`, [read]);
    expect(logged.details.status).toBe('failed');
    expect(logged.text).toMatch(/No console; use return/i);
  });

  it('超大 return 截断并给出缩小返回值的提示', async () => {
    const result = await run(`return "x".repeat(20000);`);
    expect(result.details.truncated).toBe(true);
    expect(String(result.details.hint)).toMatch(/value too large/i);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(8 * 1024);
  });

  it('calls + 返回值一起超 8KB 时仍守住上限', async () => {
    const read = mockTool('read', async (_id, params) => ({
      content: [{ type: 'text', text: 'ok' }],
      details: { path: String((params as { path: string }).path) },
    }));
    const result = await run(
      `
        const hits = await Promise.all(
          Array.from({ length: 40 }, (_, i) => read({ path: "p".repeat(80) + String(i) }))
        );
        return { n: hits.length, blob: "y".repeat(6000) };
      `,
      [read]
    );
    expect(result.details.status).toBe('completed');
    expect(result.details.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(8 * 1024);
    expect(JSON.parse(result.text).truncated).toBe(true);
  });

  it('MCP 原名 ReferenceError 会提示 did you mean', async () => {
    const search = mockTool('mcp__semble__search', async () => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    }));
    const result = await run(`return await mcp__semble__search({ query: "x" });`, [search]);
    expect(result.details.status).toBe('failed');
    expect(result.text).toMatch(/did you mean mcp_semble_search/i);
  });

  it('call(name, args) 接受原始名与转换后的名字', async () => {
    const received: unknown[] = [];
    const search = mockTool('mcp__fast-context__fast_context_search', async (_id, params) => {
      received.push(params);
      return { content: [{ type: 'text', text: 'hit' }], details: {} };
    });
    const result = await run(
      `
        const a = await call("mcp__fast-context__fast_context_search", { query: "a" });
        const b = await call("mcp_fast_context_fast_context_search", { query: "b" });
        return [a.content, b.content];
      `,
      [search]
    );
    expect(result.details.status).toBe('completed');
    expect(result.details.value).toEqual(['hit', 'hit']);
    expect(received).toEqual([{ query: 'a' }, { query: 'b' }]);
  });

  it('call 不能绕过禁用工具，未知名直接失败', async () => {
    let ran = 0;
    const sub = mockTool('subagent', async () => {
      ran += 1;
      return { content: [{ type: 'text', text: 'no' }], details: {} };
    });
    const blocked = await run(`return await call("subagent", {});`, [sub]);
    expect(blocked.details.status).toBe('failed');
    expect(blocked.text).toMatch(/not available/i);
    const unknown = await run(`return await call("mcp__nope__x", {});`, [sub]);
    expect(unknown.details.status).toBe('failed');
    expect(unknown.text).toMatch(/not available/i);
    expect(ran).toBe(0);
  });

  it('名为 call 的工具不覆盖 call()', async () => {
    const tool = mockTool('call', async () => ({
      content: [{ type: 'text', text: 'tool' }],
      details: {},
    }));
    const result = await run(`return [(await call("call", {})).content, listTools()];`, [tool]);
    expect(result.details.value).toEqual(['tool', [{ name: 'call_2', tool: 'call' }]]);
  });
});
