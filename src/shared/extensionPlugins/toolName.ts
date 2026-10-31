const PREFIX = 'plugin_';
const SEPARATOR = '__';
const EXTERNAL = /^plugin_([a-z][a-z0-9]*(?:-[a-z0-9]+)+)__([a-z][a-z0-9_]*)$/;

/** 插件 id 不含 `-` / `_`，工具名不含 `__`，故映射一一对应 */
export function pluginToolName(pluginId: string, toolName: string): string {
  return `${PREFIX}${pluginId.replaceAll('.', '-')}${SEPARATOR}${toolName}`;
}

export function parsePluginToolName(name: string): { pluginId: string; toolName: string } | null {
  const match = EXTERNAL.exec(name);
  if (!match?.[1] || !match[2] || match[2].includes(SEPARATOR)) return null;
  return { pluginId: match[1].replaceAll('-', '.'), toolName: match[2] };
}
