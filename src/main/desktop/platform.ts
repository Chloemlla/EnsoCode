/**
 * 桌面宿主的平台实现：进程级能力直接映射 Electron。
 * 构建时 `@platform` 解析到这里；tsc 解析到 platform/api.ts 做类型约束。
 */
import {
  app,
  clipboard,
  ipcMain,
  Notification,
  nativeImage,
  net,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  session,
  shell,
  systemPreferences,
  utilityProcess,
} from 'electron';
import agentWorkerPath from '../../agent/index?modulePath';
import type { DecodedImage, ProcessMetric } from '../platform/types';

export const hostKind = 'desktop' as const;
export const resourcesPath = process.resourcesPath;
export {
  agentWorkerPath,
  app,
  clipboard,
  ipcMain,
  net,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  session,
  shell,
  utilityProcess,
};

export const notification = {
  isSupported: () => Notification.isSupported(),
  show: (options: { title: string; body: string }) => {
    if (!Notification.isSupported()) return null;
    const created = new Notification({ title: options.title, body: options.body, silent: false });
    created.show();
    return created;
  },
};

export const images = {
  fromBuffer(data: Buffer): DecodedImage | null {
    const image = nativeImage.createFromBuffer(data);
    return image.isEmpty() ? null : image;
  },
};

export const mediaAccess = {
  async microphone(): Promise<boolean> {
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  },
};

export function processMetrics(): ProcessMetric[] {
  return app.getAppMetrics() as ProcessMetric[];
}
