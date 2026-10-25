import { pickActive, type StoredDevice } from './deviceList';

/** 手机版（index）与桌面模式（desk）共用同源 localStorage，记住上次所在界面 */
export type UiMode = 'phone' | 'desk';

export const UI_MODE_KEY = 'enso-phone-ui-mode';
/** 从桌面模式回手机版：带上 mode=phone，启动时据此落盘，避免又被跳回 desk */
export const PHONE_URL = '/?mode=phone';

export function loadUiMode(): UiMode {
  return localStorage.getItem(UI_MODE_KEY) === 'desk' ? 'desk' : 'phone';
}

export function saveUiMode(mode: UiMode): void {
  localStorage.setItem(UI_MODE_KEY, mode);
}

export function deskUrl(pairId: string): string {
  return `/desk?device=${encodeURIComponent(pairId)}`;
}

/** index 启动时要跳转的 desk 地址；显式回手机版或通知深链（?session=）时留在手机版 */
export function launchTarget(
  search: string,
  mode: UiMode,
  devices: readonly StoredDevice[],
  activeId: string | null
): string | null {
  if (mode !== 'desk') return null;
  const params = new URLSearchParams(search);
  if (params.get('mode') === 'phone' || params.has('session')) return null;
  const device = pickActive(devices, activeId);
  if (!device || device.scope === 'read') return null;
  return deskUrl(device.pairId);
}
