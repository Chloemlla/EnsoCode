import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type CursorTool = { name?: string; toolName?: string };

// 只执行已锁定 bundle 的纯工具路由片段，不加载 provider 或访问真实凭证；升级时复检边界。
function routingHelpers(): {
  rules: (tools: CursorTool[]) => string;
  reject: (execCase: string, tools: CursorTool[]) => string;
  prefix: (name: string) => string;
  names: (registry: string[]) => {
    wire: (name: string) => string;
    advertised: (name: string) => string;
    resolve: (name: string) => string | undefined;
  };
} {
  const require = createRequire(import.meta.url);
  const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
  const start = bundle.indexOf('var bn="pi"');
  const end = bundle.indexOf('var sl=', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return runInNewContext(
    `${bundle.slice(start, end)};({ rules: $s, reject: nl, prefix: Ps, names: Ge })`,
    {},
    { timeout: 1000 }
  );
}

describe('pi-cursor pnpm patch', () => {
  it('keeps Enso exec/interaction hooks on the installed 1.4.39 bundle', () => {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@rahularya01/pi-cursor/package.json');
    const { version } = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version: string };
    expect(version).toBe('1.4.39');
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).toContain('__ensoCursorHandleInteraction');
    expect(bundle).toContain('__ensoCursorHandleExec');
  });

  // 上游 1.4.37 起按 exec case 累计原生本地工具拒绝数，满 8 次掐断本轮；Enso 接管执行的帧不能计入
  it('exempts Enso-handled native exec frames from the local tool rejection counter', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).toMatch(/\.__ensoHandled=true/);
    expect(bundle).toMatch(/&&!\w+\.__ensoHandled&&\(\w+\.localToolRejections=/);
  });

  it('本轮工具定义优先于发现结果，先直接调用且复用已成功的路径', () => {
    const rules = routingHelpers().rules([{ name: 'bash' }, { toolName: 'read' }]);
    expect(rules).toContain('provided with the current request');
    expect(rules).toContain('Do not call GetDynamicTools to discover or validate Pi tools');
    expect(rules).not.toContain('discovery does not list pi');
    expect(rules).toContain('Call the exposed tool directly');
    expect(rules).toContain('namespace "pi"');
    expect(rules).toContain('advertised tool name');
    expect(rules).toContain('reuse that route for the rest of this run');
    expect(rules).not.toContain('tools are registered');
    expect(rules).toContain('mcp_pi_bash');
    expect(rules).toContain('mcp_pi_read');
    expect(rules).not.toContain('mcp_pi_write');
  });

  it.each(['shellArgs', 'shellStreamArgs'])('%s 拒绝后只推荐当前可用的 bash', (execCase) => {
    const result = routingHelpers().reject(execCase, [{ name: 'read' }, { name: 'bash' }]);
    expect(result).toContain('No operation was performed');
    expect(result).toContain('Use the Pi bash tool');
    expect(result).toContain('namespace "pi" and toolName "mcp_pi_bash"');
    expect(result).toContain('Do not call GetDynamicTools to discover or validate Pi tools');
    expect(result).not.toContain('discovery does not list pi');
    expect(result).toContain('do not copy native Cursor arguments unchanged');
    expect(result).not.toContain('mcp_pi_read');
  });

  it('没有 bash 时不虚构 bash，保留其它工具的能力判断', () => {
    const result = routingHelpers().reject('shellArgs', [{ name: 'powershell' }]);
    expect(result).toContain('mcp_pi_powershell');
    expect(result).not.toContain('mcp_pi_bash');
    expect(result).toContain('If none supports it, report that limitation');
  });

  it('工具名冲突时规则和拒绝提示使用上游分配的名称', () => {
    const { rules, reject } = routingHelpers();
    const tools = [{ name: 'bash' }, { name: 'mcp_pi_bash' }];
    expect(rules(tools)).toContain('call the custom tool "mcp_pi_bash" as mcp_pi_bash_2');
    expect(reject('readArgs', tools)).toContain('mcp_pi_bash_2');
    expect(reject('shellArgs', tools)).toContain('toolName "mcp_pi_bash"');
    expect(reject('shellArgs', tools)).not.toContain('mcp_pi_bash_2');
  });

  it('其它原生工具拒绝仍仅列本轮可用工具并跳过 Pi 发现', () => {
    const result = routingHelpers().reject('readArgs', [{ toolName: 'read' }]);
    expect(result).toContain('mcp_pi_read');
    expect(result).not.toContain('mcp_pi_bash');
    expect(result).toContain('Call the exposed tool directly');
    expect(result).toContain('Do not call GetDynamicTools to discover or validate Pi tools');
  });

  it('没有工具时明确能力缺失，不引导调用不存在的工具', () => {
    const { rules, reject } = routingHelpers();
    for (const result of [rules([]), reject('shellArgs', [])]) {
      expect(result).toContain('No Pi MCP tools are exposed for this request');
      expect(result).not.toContain('CallDynamicTool');
      expect(result).not.toContain('mcp_pi_bash');
    }
  });

  it('只有非本地工具时仍提供直接调用及发现跳过规则', () => {
    const result = routingHelpers().rules([{ name: 'web_search' }]);
    expect(result).toContain('Call the exposed tool directly');
    expect(result).toContain('Do not call GetDynamicTools to discover or validate Pi tools');
    expect(result).not.toContain('mcp_pi_bash');
  });

  it('历史前缀幂等且裸名与前缀名仍归一到同一工具', () => {
    const { prefix, names } = routingHelpers();
    expect(prefix('bash')).toBe('mcp_pi_bash');
    expect(prefix('mcp_pi_bash')).toBe('mcp_pi_bash');
    const map = names(['bash']);
    expect(map.resolve('bash')).toBe('bash');
    expect(map.resolve('mcp_pi_bash')).toBe('bash');
    expect(map.resolve('missing')).toBeUndefined();
  });

  it.each([
    ['bash', 'mcp_pi_bash'],
    ['mcp_pi_bash', 'bash'],
    ['bash', 'bash_2', 'mcp_pi_bash', 'mcp_pi_mcp_pi_bash'],
  ])('上游名称映射保持唯一并能往返注册表：%j', (...registry) => {
    const map = routingHelpers().names(registry);
    const wires = registry.map(map.wire);
    const advertised = registry.map(map.advertised);
    expect(new Set(wires).size).toBe(registry.length);
    expect(new Set(advertised).size).toBe(registry.length);
    expect(wires.every((name) => !name.startsWith('mcp_pi_'))).toBe(true);
    for (const name of registry) {
      expect(map.resolve(map.wire(name))).toBe(name);
      expect(map.resolve(map.advertised(name))).toBe(name);
    }
    expect(map.resolve('mcp_pi_bash')).toBe('bash');
  });

  // 上游 1.4.32 已不再发 model_details（#23）。回归守卫：补丁只挂 hook，不能把字段加回去。
  it('keeps the upstream Run request without modelDetails', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).not.toContain('modelDetails');
    expect(bundle).toMatch(/requestedModel:\w+/);
  });
});
