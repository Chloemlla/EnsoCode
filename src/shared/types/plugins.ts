/** Claude Code 格式插件：从 Claude Code 已装插件导入，Enso 自己开关；组件在 spawn 时按 key 现读 */
export interface PluginEntry {
  id: string;
  /** Claude Code 的 `name@marketplace`；Main 据此从 installed_plugins.json 找安装目录 */
  key: string;
  name: string;
  description: string;
  version?: string;
  source: string;
  enabled: boolean;
}

export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionEnd',
] as const;
export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];

/** 一条可执行的 command hook（已按插件展开根目录与数据目录） */
export interface PluginHookSpawn {
  plugin: string;
  /** CLAUDE_PLUGIN_ROOT */
  root: string;
  /** CLAUDE_PLUGIN_DATA */
  dataDir: string;
  event: ClaudeHookEvent;
  matcher?: string;
  command: string;
  timeoutSec?: number;
}

/** 插件命令 → pi 提示词模板（`/plugin:command`） */
export interface PluginCommandSpawn {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  filePath: string;
}

/** 设置页展示用的插件组件摘要 */
export interface PluginComponentSummary {
  skills: string[];
  commands: string[];
  agents: string[];
  mcpServers: Array<{ name: string; target: string }>;
  hooks: Array<{ event: string; command: string }>;
  /** 暂不支持的组件（如 lspServers、outputStyles） */
  unsupported: string[];
}

export interface InstalledPluginInfo {
  key: string;
  name: string;
  description: string;
  version?: string;
  marketplace: string;
  components: PluginComponentSummary;
}

const MAX_ITEMS = 500;
const MAX_TEXT = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function parsePluginHooks(value: unknown): PluginHookSpawn[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  for (const hook of value) {
    if (
      !isRecord(hook) ||
      !onlyKeys(hook, ['plugin', 'root', 'dataDir', 'event', 'matcher', 'command', 'timeoutSec']) ||
      !isText(hook.plugin, 256) ||
      !isText(hook.root) ||
      !isText(hook.dataDir) ||
      !(CLAUDE_HOOK_EVENTS as readonly unknown[]).includes(hook.event) ||
      (hook.matcher !== undefined && typeof hook.matcher !== 'string') ||
      !isText(hook.command, 16384) ||
      (hook.timeoutSec !== undefined &&
        !(typeof hook.timeoutSec === 'number' && hook.timeoutSec > 0 && hook.timeoutSec <= 3600))
    ) {
      return null;
    }
  }
  return value as PluginHookSpawn[];
}

export function parsePluginCommands(value: unknown): PluginCommandSpawn[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  for (const command of value) {
    if (
      !isRecord(command) ||
      !onlyKeys(command, ['name', 'description', 'argumentHint', 'content', 'filePath']) ||
      !isText(command.name, 256) ||
      typeof command.description !== 'string' ||
      (command.argumentHint !== undefined && typeof command.argumentHint !== 'string') ||
      !isText(command.content, MAX_TEXT) ||
      !isText(command.filePath)
    ) {
      return null;
    }
  }
  return value as PluginCommandSpawn[];
}

export function isPluginEntry(value: unknown): value is PluginEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isText(value.key, 512) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.source === 'string' &&
    typeof value.enabled === 'boolean'
  );
}
