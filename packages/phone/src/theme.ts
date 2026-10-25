import type { HostAppearance } from '@enso/pair';
import { applyTerminalThemeToApp, clearTerminalThemeFromApp } from './stubs/ghostty-theme';
import { setAppearanceTheme } from './stubs/settings-store';
import { setThemeColor, toRgb } from './themeColor';
import { settingsThemeFromPhone, type ThemePreference } from './themePreference';

/**
 * 主题优先级：本地覆盖 > 桌面下发 > 跟随系统。
 * 一旦用户在手机上显式选过，就不再被桌面的主题变更打断。
 * sync-terminal 与桌面同语义：整套 UI 配色由终端调色板推导。
 */

export type { ThemePreference } from './themePreference';

const OVERRIDE_KEY = 'enso-phone-theme';

let hostTheme: HostAppearance = 'system';
let override: ThemePreference = readOverride();
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readOverride(): ThemePreference {
  const raw = localStorage.getItem(OVERRIDE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

/**
 * 让 Safari 的状态栏/工具栏底色跟随页面。写死的 theme-color 在主题切换后
 * 会与页面对不上，表现为上下两条系统灰边。下一帧再读以确保新变量已生效。
 */
function syncThemeColorMeta(): void {
  requestAnimationFrame(() => {
    const computed = getComputedStyle(document.body).backgroundColor;
    if (computed) setThemeColor(toRgb(computed));
  });
}

function apply(): void {
  // 本地覆盖优先，且覆盖时不套终端配色（用户要的是明确的浅/深）
  if (override !== 'auto') {
    clearTerminalThemeFromApp();
    document.documentElement.classList.toggle('dark', override === 'dark');
  } else if (hostTheme === 'sync-terminal') {
    applyTerminalThemeToApp(undefined, true);
  } else {
    clearTerminalThemeFromApp();
    const dark = hostTheme === 'system' ? media.matches : hostTheme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
  }
  for (const listener of listeners) listener();
  syncThemeColorMeta();
  const appearance = settingsThemeFromPhone(override, hostTheme);
  setAppearanceTheme(appearance.theme, appearance.syncTerminalTheme);
}

/** 桌面下发的偏好（仅在未本地覆盖时生效） */
export function setHostTheme(theme: HostAppearance): void {
  hostTheme = theme;
  apply();
}

/** 终端调色板更新后需重算（sync-terminal 依赖它） */
export function refreshTheme(): void {
  apply();
}

export function getThemePreference(): ThemePreference {
  return override;
}

export function setThemePreference(next: ThemePreference): void {
  override = next;
  if (next === 'auto') localStorage.removeItem(OVERRIDE_KEY);
  else localStorage.setItem(OVERRIDE_KEY, next);
  apply();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initTheme(): void {
  apply();
  media.addEventListener('change', apply);
}
