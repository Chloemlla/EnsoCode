import type { ComputerWindowInfo } from '@shared/computer/types';

const APP_ALIASES: Record<string, readonly string[]> = {
  wechat: ['微信', 'weixin'],
  weixin: ['微信', 'wechat'],
  微信: ['wechat', 'weixin'],
  chrome: ['google chrome'],
  'google chrome': ['chrome'],
  code: ['visual studio code', 'vscode', 'cursor'],
  vscode: ['visual studio code', 'code'],
  'visual studio code': ['code', 'vscode'],
  'vs code': ['visual studio code', 'code', 'vscode'],
};

function needle(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLocaleLowerCase() : undefined;
}

function textMatches(haystack: string, raw: string): boolean {
  const h = haystack.toLocaleLowerCase();
  const n = raw.toLocaleLowerCase();
  if (h.includes(n) || n.includes(h)) return true;
  return (APP_ALIASES[n] ?? []).some((alias) => h.includes(alias) || alias.includes(h));
}

export function matchWindow(window: ComputerWindowInfo, filter: Record<string, unknown>): boolean {
  const app = needle(filter.app);
  const title = needle(filter.title);
  const any = needle(filter.name) ?? needle(filter.query);
  if (app && !textMatches(window.app, app)) return false;
  if (title && !textMatches(window.title, title)) return false;
  if (any && !textMatches(window.app, any) && !textMatches(window.title, any)) return false;
  return true;
}

export function pickMatchedWindow(matched: ComputerWindowInfo[]): ComputerWindowInfo | undefined {
  if (matched.length === 0) return undefined;
  return matched.find((window) => window.focused) ?? matched[0];
}

export function resolveWindow(
  windows: ComputerWindowInfo[],
  raw: unknown
): ComputerWindowInfo | undefined {
  if (typeof raw === 'string') {
    const id = raw.trim();
    const byId = windows.find((window) => window.id === id);
    if (byId) return byId;
    return pickMatchedWindow(windows.filter((window) => matchWindow(window, { query: raw })));
  }
  const filter =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (typeof filter.id === 'string') {
    const byId = windows.find((window) => window.id === filter.id);
    if (byId) return byId;
  }
  return pickMatchedWindow(windows.filter((window) => matchWindow(window, filter)));
}
