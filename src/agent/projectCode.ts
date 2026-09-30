import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';

/** 项目 settings 里能让 pi 执行代码的键（扩展/包由单独规则处理） */
const COMMAND_SETTINGS = ['npmCommand', 'shellPath', 'shellCommandPrefix'] as const;

function projectSettingsPath(cwd: string): string {
  return join(cwd, '.pi', 'settings.json');
}

function parseObject(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function packageSource(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (
    entry &&
    typeof entry === 'object' &&
    typeof (entry as { source?: unknown }).source === 'string'
  ) {
    return (entry as { source: string }).source;
  }
  return undefined;
}

/** 项目内会被 pi 当作代码加载或执行的来源（.pi/extensions、项目包、扩展路径、命令类设置） */
export function listProjectCodeSources(cwd: string): string[] {
  const sources = new Set<string>();
  const extensionsDir = join(cwd, '.pi', 'extensions');
  if (existsSync(extensionsDir)) {
    try {
      for (const name of readdirSync(extensionsDir)) {
        if (!name.startsWith('.') && name !== 'node_modules') sources.add(`.pi/extensions/${name}`);
      }
    } catch {
      sources.add('.pi/extensions');
    }
  }
  const settings = parseObject(readText(projectSettingsPath(cwd)));
  if (settings) {
    for (const entry of Array.isArray(settings.packages) ? settings.packages : []) {
      const source = packageSource(entry);
      if (source) sources.add(`package:${source}`);
    }
    for (const entry of Array.isArray(settings.extensions) ? settings.extensions : []) {
      if (typeof entry === 'string' && !/^[!+-]/.test(entry)) sources.add(`extension:${entry}`);
    }
    for (const key of COMMAND_SETTINGS) {
      if (settings[key] !== undefined) sources.add(`setting:${key}`);
    }
  }
  return [...sources].sort();
}

/** 去掉项目 settings 里的代码来源，并排除 .pi/extensions 自动发现；技能、提示词等内容保留 */
function sanitizeProjectSettings(text: string | undefined): string {
  const { packages: _packages, ...rest } = parseObject(text) ?? {};
  for (const key of COMMAND_SETTINGS) delete rest[key];
  return JSON.stringify({ ...rest, extensions: ['!**'] });
}

/**
 * 给 DefaultResourceLoader 用的 SettingsManager：项目代码来源须全部在 trusted 里才按 pi 默认加载，
 * 否则整个项目的扩展与包都不加载（pi 默认信任项目，打开仓库即执行其扩展、自动安装其包）。
 */
export function createProjectSettingsManager(
  cwd: string,
  agentDir: string,
  trusted: readonly string[]
): { settingsManager: SettingsManager; blocked: string[] } {
  const sources = listProjectCodeSources(cwd);
  const blocked = sources.filter((source) => !trusted.includes(source));
  if (sources.length > 0 && blocked.length === 0) {
    return { settingsManager: SettingsManager.create(cwd, agentDir), blocked };
  }
  const paths = { global: join(agentDir, 'settings.json'), project: projectSettingsPath(cwd) };
  const settingsManager = SettingsManager.fromStorage({
    // 只读：loader 不写 settings，拒绝写入避免改动用户文件
    withLock(scope, fn) {
      const current = readText(paths[scope]);
      fn(scope === 'project' ? sanitizeProjectSettings(current) : current);
    },
  });
  return { settingsManager, blocked };
}
