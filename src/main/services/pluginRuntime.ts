import { createHash } from 'node:crypto';
import type { AgentTypeEntry } from '../../shared/types/assets';
import { isPluginEntry, type PluginEntry } from '../../shared/types/plugins';
import {
  DEFAULT_CLAUDE_PLUGINS_DIR,
  type ResolvedPlugins,
  resolvePluginsForSpawn,
} from './claudePlugins';

export type RuntimeAgentType = AgentTypeEntry & { pluginSkillPaths?: string[] };

export function settingsPluginEntries(state: Record<string, unknown> | undefined): PluginEntry[] {
  return Array.isArray(state?.plugins) ? state.plugins.filter(isPluginEntry) : [];
}

export function enabledPlugins(
  state: Record<string, unknown> | undefined,
  pluginsDir = DEFAULT_CLAUDE_PLUGINS_DIR
): ResolvedPlugins {
  return resolvePluginsForSpawn(settingsPluginEntries(state), {
    pluginsDir,
    env: process.env,
  });
}

/** 名字派生的稳定 UUID（v5 位型）：registry 的 custom typeKey 需要 UUID */
export function pluginAgentTypeId(name: string): string {
  const hex = createHash('sha1').update(`enso-plugin-agent:${name}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** 用户自定义类型 + 已启用插件的子代理；同名以用户自定义为准 */
export function withPluginAgentTypes(
  custom: readonly AgentTypeEntry[],
  state: Record<string, unknown> | undefined,
  resolved?: ResolvedPlugins
): RuntimeAgentType[] {
  const agents = (resolved ?? enabledPlugins(state)).agents;
  if (agents.length === 0) return [...custom];
  const taken = new Set(custom.map((entry) => entry.name.trim().toLowerCase()));
  const plugin = agents
    .filter((agent) => !taken.has(agent.name.toLowerCase()))
    .map(
      (agent): RuntimeAgentType => ({
        id: pluginAgentTypeId(agent.name),
        name: agent.name,
        description: agent.description || agent.name,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        modelMode: 'follow',
        pluginSkillPaths: agent.skillPaths,
      })
    );
  return [...custom, ...plugin];
}
