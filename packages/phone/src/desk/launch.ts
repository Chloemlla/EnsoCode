/** 宿主 /meta 的结果：renderer 构建号决定 SW 缓存与资源路径 */
export interface DeskMeta {
  version: string;
  platform: string;
}

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

const key = (pairId: string) => `enso-desk-meta:${pairId}`;
const BUILD = /^[\w.+-]{1,64}$/;

/** 上次连上时的构建：启动时据此直接从 SW 缓存起 renderer，不必等一次往返 */
export function loadDeskMeta(storage: KeyValue, pairId: string): DeskMeta | null {
  try {
    const value = JSON.parse(storage.getItem(key(pairId)) ?? '') as Partial<DeskMeta> | null;
    if (!value || typeof value.version !== 'string' || typeof value.platform !== 'string')
      return null;
    if (!BUILD.test(value.version) || value.version.includes('..')) return null;
    return { version: value.version, platform: value.platform };
  } catch {
    return null;
  }
}

export function saveDeskMeta(storage: KeyValue, pairId: string, meta: DeskMeta): void {
  try {
    storage.setItem(key(pairId), JSON.stringify(meta));
  } catch {}
}

export const deskBase = (pairId: string, version: string): string =>
  `/desk/r/${encodeURIComponent(pairId)}/${encodeURIComponent(version)}`;

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** 「1.2 / 4.8 MB」；旧桌面不报总量时只显示已下载。估算有偏差，未完成前不超过总量 */
export function downloadProgress(done: number, total?: number): string {
  if (!total) return `${mb(done)} MB`;
  return `${mb(Math.min(done, total * 0.99))} / ${mb(total)} MB`;
}
