import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const aliases: Record<string, string> = {
  '@platform': 'src/server/platform.ts',
  '@shared': 'src/shared',
  '@enso/pair': 'packages/pair/src/index.ts',
};
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolveSpecifier(from: string, spec: string): string | null {
  if (spec.startsWith('.')) return resolveFile(resolve(dirname(from), spec));
  for (const [alias, target] of Object.entries(aliases)) {
    if (spec === alias) return resolveFile(join(root, target));
    if (spec.startsWith(`${alias}/`))
      return resolveFile(join(root, target, spec.slice(alias.length + 1)));
  }
  return null;
}

/** 服务端入口的整张静态依赖图（含动态 import）都不能碰 Electron。 */
function electronLeaks(entry: string): string[] {
  const seen = new Set<string>();
  const leaks: string[] = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      if (/^(?:import|export)\s+type\s/.test(match[0])) continue;
      const spec = match[1] ?? match[2];
      if (spec === 'electron' || spec.startsWith('electron/') || spec.includes('?modulePath')) {
        leaks.push(`${relative(root, file)} -> ${spec}`);
        continue;
      }
      const next = resolveSpecifier(file, spec);
      if (next && !next.includes('.test.')) stack.push(next);
    }
  }
  return leaks;
}

describe('server electron boundary', () => {
  it('server entry never reaches electron', () => {
    expect(electronLeaks(join(root, 'src/server/index.ts'))).toEqual([]);
  });
});
