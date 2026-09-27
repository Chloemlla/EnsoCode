import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { McpServerEntry } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import { McpToolCatalogStore } from './mcpToolCatalog';

vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));

import {
  expectedAgentTypeToolIds,
  rememberParentToolProfile,
  resolvePresetSystemPrompt,
  toSessionMcpConfig,
} from './agentHost';

describe('agentHost session MCP config', () => {
  it('deferred 带 loadMode 与缓存工具名，direct 与缺省保持原样', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'enso-session-mcp-'));
    const catalog = new McpToolCatalogStore(path.join(dir, 'catalog.json'));
    const entry = (loadMode?: McpServerEntry['loadMode']): McpServerEntry => ({
      id: 's1',
      name: 'search',
      transport: 'stdio',
      command: 'search-mcp',
      source: 'manual',
      enabled: true,
      ...(loadMode ? { loadMode } : {}),
    });
    expect(toSessionMcpConfig(entry('deferred'), catalog)).toEqual({
      id: 's1',
      name: 'search',
      transport: 'stdio',
      command: 'search-mcp',
      loadMode: 'deferred',
    });
    catalog.record(entry(), ['find']);
    expect(toSessionMcpConfig(entry('deferred'), catalog)).toMatchObject({ toolNames: ['find'] });
    for (const config of [
      toSessionMcpConfig(entry('direct'), catalog),
      toSessionMcpConfig(entry(), catalog),
    ]) {
      expect(config).not.toHaveProperty('loadMode');
      expect(config).not.toHaveProperty('toolNames');
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('agentHost agent type tool filtering', () => {
  it('all 按编辑模式只期望一套写工具，readonly 不开放写工具', () => {
    expect(
      expectedAgentTypeToolIds('all', { editMode: 'apply_patch', isolatedSandbox: false })
    ).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'apply_patch',
      'message_main_agent',
      'message_coworker',
    ]);
    expect(
      expectedAgentTypeToolIds('all', { editMode: 'replace', isolatedSandbox: false })
    ).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'edit',
      'write',
      'message_main_agent',
      'message_coworker',
    ]);
    expect(expectedAgentTypeToolIds('readonly', { isolatedSandbox: false })).not.toContain(
      'apply_patch'
    );
  });

  it('proof 使用父会话 spawn 时的工具档，而不是后来的全局设置', () => {
    rememberParentToolProfile('parent-snapshot', {
      editMode: 'replace',
      isolatedSandbox: false,
      exploreFold: false,
    });
    expect(expectedAgentTypeToolIds('all', { parentSessionId: 'parent-snapshot' })).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'edit',
      'write',
      'message_main_agent',
      'message_coworker',
    ]);
    expect(
      expectedAgentTypeToolIds('readonly', { parentSessionId: 'parent-snapshot' })
    ).not.toContain('bash');
  });
});

describe('agentHost preset system prompt authority', () => {
  it('无引用沿用默认，引用正文读取失败时明确拒绝 spawn 所需配置', () => {
    expect(resolvePresetSystemPrompt()).toEqual({ ok: true });
    expect(
      resolvePresetSystemPrompt({ systemPromptId: '11111111-1111-4111-8111-111111111111' })
    ).toEqual({ ok: false });
  });
});
