import { IPC_CHANNELS } from '@shared/types';
import { ipcMain } from 'electron';
import { computerHost } from '../services/computerHost';

export function registerComputerHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.COMPUTER_CAPABILITIES, async () => {
    try {
      return { ok: true as const, capabilities: await computerHost.capabilities() };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle(IPC_CHANNELS.COMPUTER_OPEN_PERMISSIONS, (_event, kind: unknown) => {
    if (kind !== 'screen' && kind !== 'accessibility') {
      return { ok: false as const, error: 'Invalid permission kind' };
    }
    return computerHost.openPermissionSettings(kind);
  });
}
