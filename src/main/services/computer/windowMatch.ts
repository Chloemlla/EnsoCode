import type { ComputerWindowInfo } from '@shared/computer/types';
import { appLaunchAliases } from './appLaunch';

const APP_ALIASES: Record<string, readonly string[]> = {
  wechat: ['微信', 'weixin'],
  weixin: ['微信', 'wechat'],
  微信: ['wechat', 'weixin'],
  finder: ['访达'],
  访达: ['finder'],
  'activity monitor': ['活动监视器'],
  活动监视器: ['activity monitor'],
  chrome: ['google chrome'],
  'google chrome': ['chrome'],
  code: ['visual studio code', 'vscode', 'cursor'],
  vscode: ['visual studio code', 'code'],
  'visual studio code': ['code', 'vscode'],
  'vs code': ['visual studio code', 'code', 'vscode'],
  // Windows 窗口的 app 是进程名（notepad、explorer、msedge…）
  notepad: ['记事本'],
  记事本: ['notepad'],
  explorer: ['文件资源管理器', '资源管理器', 'file explorer'],
  文件资源管理器: ['explorer'],
  资源管理器: ['explorer'],
  'file explorer': ['explorer'],
  edge: ['msedge', 'microsoft edge'],
  'microsoft edge': ['msedge'],
  msedge: ['edge', 'microsoft edge'],
  ...appLaunchAliases(),
};

function needle(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLocaleLowerCase() : undefined;
}
function textMatches(haystack: string, raw: string, loose = false): boolean {
  const h = haystack.toLocaleLowerCase();
  const n = raw.toLocaleLowerCase();
  if (!h || !n) return false;
  if (h.includes(n)) return true;
  if (loose && n.includes(h)) return true;
  if (!loose) return false;
  return (APP_ALIASES[n] ?? []).some((alias) => h.includes(alias) || alias.includes(h));
}

export function matchWindow(window: ComputerWindowInfo, filter: Record<string, unknown>): boolean {
  const app = needle(filter.app);
  const any = needle(filter.name) ?? needle(filter.query);
  if (app && !textMatches(window.app, app, true)) return false;
  if (typeof filter.title === 'string') {
    if (!filter.title.trim()) {
      if (window.title.trim() !== '') return false;
    } else if (!textMatches(window.title, filter.title)) return false;
  }
  if (any && !textMatches(window.app, any, true) && !textMatches(window.title, any)) return false;
  return true;
}

/** 输入法指示器、补全气泡等也是该 App 的窗口；有正常大小的窗口时不选它们 */
function isSubstantial(window: ComputerWindowInfo): boolean {
  return window.width >= 120 && window.height >= 80;
}

export function pickMatchedWindow(matched: ComputerWindowInfo[]): ComputerWindowInfo | undefined {
  const substantial = matched.filter(isSubstantial);
  const pool = substantial.length > 0 ? substantial : matched;
  return pool.find((window) => window.focused) ?? pool[0];
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
