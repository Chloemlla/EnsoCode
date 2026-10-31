import { ipcMain } from '@platform';
import { IPC_CHANNELS } from '@shared/types';
import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron';
import { getExtensionPlugins } from '../services/extensionPlugins';

/** 桌面壳：弹系统对话框选插件目录或 zip，再暂存。远端没有这个通道 */
export function registerExtensionPluginDesktopHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.EXTENSION_PLUGINS_PICK_AND_STAGE, async (event, kind: unknown) => {
    if (kind !== 'dir' && kind !== 'zip') return { ok: false, error: '参数不合法' };
    const win = BrowserWindow.fromWebContents(event.sender as unknown as WebContents);
    const owner = win && !win.isDestroyed() ? win : BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      properties: [kind === 'dir' ? 'openDirectory' : 'openFile'],
      ...(kind === 'zip' ? { filters: [{ name: 'ZIP', extensions: ['zip'] }] } : {}),
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const picked = result.filePaths[0];
    if (result.canceled || !picked) return { ok: true, cancelled: true };
    return getExtensionPlugins().stage({ kind, path: picked });
  });
}
