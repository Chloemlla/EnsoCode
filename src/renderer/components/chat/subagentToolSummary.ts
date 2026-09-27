import { unwrapMcpProxyCall } from '@/lib/mcpToolName';

const SEARCH_KEYS = ['pattern', 'query', 'path', 'file_path'] as const;
const READ_KEYS = ['path', 'file_path', 'query', 'pattern'] as const;
const COMMAND_KEYS = ['command', 'cmd', 'script'] as const;
const DEFAULT_KEYS = [
  'path',
  'file_path',
  'pattern',
  'query',
  'command',
  'url',
  'description',
  'summary',
] as const;
const MAX_SUMMARY_LENGTH = 120;

function oneLine(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > MAX_SUMMARY_LENGTH
    ? `${compact.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : compact;
}

function keysForTool(toolName: string): readonly string[] {
  const name = toolName.toLowerCase();
  if (name.includes('search') || name.includes('grep') || name === 'find') return SEARCH_KEYS;
  if (name === 'read' || name.endsWith('_read')) return READ_KEYS;
  if (name === 'bash' || name.includes('shell') || name.includes('terminal')) return COMMAND_KEYS;
  return DEFAULT_KEYS;
}

export function summarizeSubagentToolArgs(toolName: string, argumentsText: string): string {
  const input = argumentsText.trim();
  if (!input) return '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return oneLine(input);
  }
  if (parsed === null) return '';
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return oneLine(JSON.stringify(parsed) ?? String(parsed));
  }

  const call = unwrapMcpProxyCall(toolName, parsed);
  if (call.summary !== undefined) return oneLine(call.summary);
  if (!call.args || typeof call.args !== 'object') return '';
  const record = call.args as Record<string, unknown>;
  for (const key of keysForTool(call.name)) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return oneLine(value);
  }
  const fallback = JSON.stringify(record);
  return fallback === '{}' ? '' : oneLine(fallback);
}
