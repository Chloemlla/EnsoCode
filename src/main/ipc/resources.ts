import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  isCleanableStorageCategory,
  parseSessionCleanRequest,
  type StorageScanProgress,
} from '@shared/resources';
import { IPC_CHANNELS } from '@shared/types';
import { ipcMain, shell } from 'electron';
import {
  cancelStorageScan,
  cleanStorage,
  lastStorageSnapshot,
  sampleResources,
  scanStorage,
} from '../services/resourceMonitor';
import { sendToWindow } from '../windows/createAppWindow';
import { getMainWindow, isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

const CLEAN_TIMEOUT_MS = 60_000;
const pendingCleans = new Map<string, (removed: number) => void>();

function assertTrusted(webContentsId: number): void {
  if (!isMainWebContents(webContentsId) && !isSettingsWebContents(webContentsId)) {
    throw new Error('Untrusted sender');
  }
}

export function registerResourceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.RESOURCES_SAMPLE, (event) => {
    assertTrusted(event.sender.id);
    return sampleResources();
  });
  ipcMain.handle(IPC_CHANNELS.RESOURCES_STORAGE_SCAN, (event) => {
    assertTrusted(event.sender.id);
    const sender = event.sender;
    // 发起窗口关闭即取消，避免后台空转
    const onGone = () => cancelStorageScan();
    sender.once('destroyed', onGone);
    return scanStorage((progress: StorageScanProgress) => {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.RESOURCES_STORAGE_PROGRESS, progress);
    }).finally(() => sender.removeListener('destroyed', onGone));
  });
  ipcMain.handle(IPC_CHANNELS.RESOURCES_STORAGE_CANCEL, (event) => {
    assertTrusted(event.sender.id);
    cancelStorageScan();
  });
  ipcMain.handle(IPC_CHANNELS.RESOURCES_STORAGE_LAST, (event) => {
    assertTrusted(event.sender.id);
    return lastStorageSnapshot();
  });
  ipcMain.handle(IPC_CHANNELS.RESOURCES_STORAGE_CLEAN, async (event, category: unknown) => {
    assertTrusted(event.sender.id);
    if (!isCleanableStorageCategory(category)) throw new Error('Invalid category');
    return cleanStorage(category);
  });
  // 只认最近一次扫描里的根目录，renderer 传的是根 id + 相对路径
  ipcMain.handle(IPC_CHANNELS.RESOURCES_STORAGE_REVEAL, (event, rootId: unknown, rel: unknown) => {
    assertTrusted(event.sender.id);
    const root = lastStorageSnapshot()?.roots.find((r) => r.id === rootId)?.path;
    if (!root || typeof rel !== 'string') return;
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) return;
    shell.showItemInFolder(target);
  });
  // 会话删除必须走主窗口 store 的 removeConversation（worktree、worker、authority 级联）
  ipcMain.handle(IPC_CHANNELS.RESOURCES_SESSIONS_CLEAN, async (event, request: unknown) => {
    assertTrusted(event.sender.id);
    const parsed = parseSessionCleanRequest(request);
    if (!parsed) throw new Error('Invalid session clean request');
    const window = getMainWindow();
    if (!window || window.isDestroyed()) throw new Error('Main window is not open');
    const requestId = randomUUID();
    const removed = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCleans.delete(requestId);
        reject(new Error('Session cleanup timed out'));
      }, CLEAN_TIMEOUT_MS);
      pendingCleans.set(requestId, (count) => {
        clearTimeout(timer);
        resolve(count);
      });
      sendToWindow(window, IPC_CHANNELS.RESOURCES_SESSIONS_CLEAN_REQUEST, {
        requestId,
        request: parsed,
      });
    });
    return { removed, snapshot: await scanStorage() };
  });
  ipcMain.handle(
    IPC_CHANNELS.RESOURCES_SESSIONS_CLEAN_DONE,
    (event, requestId: unknown, removed: unknown) => {
      if (!isMainWebContents(event.sender.id) || typeof requestId !== 'string') return;
      const resolve = pendingCleans.get(requestId);
      pendingCleans.delete(requestId);
      resolve?.(typeof removed === 'number' && removed >= 0 ? removed : 0);
    }
  );
}
