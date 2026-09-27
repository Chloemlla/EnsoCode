import { IPC_CHANNELS } from '@shared/types';
import { app, ipcMain } from 'electron';
import { isMainWebContents } from '../windows/MainWindow';

export function toBadgeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999
    ? value
    : null;
}

export function registerAppBadgeHandlers(): void {
  ipcMain.on(IPC_CHANNELS.APP_SET_BADGE_COUNT, (event, value: unknown) => {
    if (!isMainWebContents(event.sender.id)) return;
    const count = toBadgeCount(value);
    if (count !== null) app.setBadgeCount(count);
  });
}
