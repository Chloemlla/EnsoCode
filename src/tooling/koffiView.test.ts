import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * koffi.view 把外部 native 内存包成 ArrayBuffer；Electron 开了 V8 内存沙箱，
 * 这在 Main / utilityProcess 里会直接 FATAL 退出进程。纯 Node 的单测和探针都测不出来，
 * 所以用静态扫描挡住。改用 koffi.decode(ptr, koffi.array(type, n, 'Array')) 按值拷贝。
 * 见 docs/engineering-reference/big-question/koffi-view-electron-sandbox.md
 */

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('koffi usage under Electron', () => {
  it('never wraps native memory with koffi.view', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bkoffi\s*\.\s*view\s*\(/g)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
