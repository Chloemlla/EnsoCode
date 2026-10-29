import { execFile, execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NpmInstaller } from './serverUpdater';

const run = promisify(execFile);

/** 优先用与当前 node 同目录的 npm：systemd 的 PATH 不一定包含 nvm 之类的目录 */
export function npmBin(): string {
  const sibling = path.join(path.dirname(process.execPath), 'npm');
  return existsSync(sibling) ? sibling : 'npm';
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 只有装在可写的全局 node_modules 下才自更新；npx 缓存、源码目录返回 null */
export function globalNpmInstaller(appRoot: string): NpmInstaller | null {
  const npm = npmBin();
  let root: string;
  try {
    root = realpathSync(
      execFileSync(npm, ['root', '-g'], { encoding: 'utf8', timeout: 15_000 }).trim()
    );
    if (!isInside(realpathSync(appRoot), root)) return null;
    accessSync(root, constants.W_OK);
  } catch {
    return null;
  }
  const npmRun = async (args: string[]) => {
    await run(npm, [...args, '--no-fund', '--no-audit'], { timeout: 15 * 60_000 });
  };
  return {
    prefetch: (spec) => npmRun(['cache', 'add', spec]),
    install: (spec) => npmRun(['install', '-g', spec, '--prefer-offline']),
  };
}
