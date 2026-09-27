import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import {
  type CleanCandidateFile,
  classifyStoragePath,
  pickCleanTargets,
  type SessionFileRef,
  STORAGE_CATEGORY_IDS,
  type StorageCategory,
  type StorageCategoryId,
  type StorageRootId,
  type StorageScanProgress,
  sessionStorageOwner,
  storageEntryKey,
} from '@shared/resources';

/** 扫盘跑在 worker 线程：几十万文件的 stat 与归类不占 main 事件循环；main 可随时 terminate 取消。 */

export interface ScanRootSpec {
  id: StorageRootId;
  path: string;
  /** 统计时跟随软链（dev 常把模型目录链到正式版）；清理从不跟随 */
  follow: boolean;
}

export type StorageWorkerData =
  | { mode: 'scan'; roots: ScanRootSpec[]; browserDir: string; refs: SessionFileRef[] }
  | {
      mode: 'collect';
      root: string;
      browserDir: string;
      refs: SessionFileRef[];
      indexReady: boolean;
      category: StorageCategoryId;
      now: number;
    };

export interface ScanResult {
  categories: StorageCategory[];
  rootBytes: Partial<Record<StorageRootId, number>>;
  sessionBytes: [string, number][];
  errorCount: number;
  errors: string[];
}

export type StorageWorkerMessage =
  | { type: 'progress'; progress: StorageScanProgress }
  | { type: 'scan-done'; result: ScanResult }
  | { type: 'collect-done'; targets: { abs: string; bytes: number }[]; skipped: number }
  | { type: 'error'; message: string };

const ENTRY_LIMIT = 8;
const ERROR_SAMPLES = 5;
const PROGRESS_MS = 150;
const toPosix = (value: string) => value.split(path.sep).join('/');

interface WalkErrors {
  count: number;
  samples: string[];
}

async function walk(
  root: string,
  follow: boolean,
  errors: WalkErrors,
  visit: (file: CleanCandidateFile) => void
): Promise<void> {
  const stack = [''];
  const seen = new Set<string>();
  const fail = (p: string) => {
    errors.count += 1;
    if (errors.samples.length < ERROR_SAMPLES) errors.samples.push(p);
  };
  while (stack.length > 0) {
    const relDir = stack.pop() as string;
    const dir = path.join(root, relDir);
    if (follow) {
      const real = await realpath(dir).catch(() => null);
      if (!real || seen.has(real)) continue;
      seen.add(real);
    }
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // 根目录不存在不算错误
      if (relDir || (error as NodeJS.ErrnoException).code !== 'ENOENT') fail(dir);
      continue;
    }
    const files: string[] = [];
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) stack.push(rel);
      else if (entry.isFile()) files.push(rel);
      else if (follow && entry.isSymbolicLink()) {
        const st = await stat(path.join(root, rel)).catch(() => null);
        if (st?.isDirectory()) stack.push(rel);
        else if (st?.isFile()) files.push(rel);
      }
    }
    for (let i = 0; i < files.length; i += 64) {
      await Promise.all(
        files.slice(i, i + 64).map(async (rel) => {
          const abs = path.join(root, rel);
          const st = await (follow ? stat : lstat)(abs).catch(() => null);
          if (st) visit({ rel, abs, bytes: st.size, mtimeMs: st.mtimeMs });
          else fail(abs);
        })
      );
    }
  }
}

async function scan(data: Extract<StorageWorkerData, { mode: 'scan' }>): Promise<ScanResult> {
  const owner = sessionStorageOwner(data.refs);
  const acc = new Map<
    StorageCategoryId,
    { bytes: number; files: number; entries: Map<string, number> }
  >(STORAGE_CATEGORY_IDS.map((id) => [id, { bytes: 0, files: 0, entries: new Map() }]));
  const entryRoot = new Map<string, StorageRootId>();
  const sessionBytes = new Map<string, number>();
  const rootBytes: Partial<Record<StorageRootId, number>> = {};
  const errors: WalkErrors = { count: 0, samples: [] };
  let files = 0;
  let bytes = 0;
  let lastPost = 0;
  for (const root of data.roots) {
    const external = root.id !== 'data';
    const prefix = toPosix(root.path);
    await walk(root.path, root.follow, errors, (file) => {
      // 外部根的文件用绝对 posix 路径参与会话归属（与 worktreeRel 的外部写法一致）
      const ownerKey = external ? `${prefix}/${file.rel}` : file.rel;
      const id = owner(ownerKey);
      if (id) sessionBytes.set(id, (sessionBytes.get(id) ?? 0) + file.bytes);
      const category = external ? 'worktrees' : classifyStoragePath(file.rel, data.browserDir);
      const bucket = acc.get(category);
      if (bucket) {
        bucket.bytes += file.bytes;
        bucket.files += 1;
        const key = `${root.id}:${storageEntryKey(file.rel)}`;
        entryRoot.set(key, root.id);
        bucket.entries.set(key, (bucket.entries.get(key) ?? 0) + file.bytes);
      }
      rootBytes[root.id] = (rootBytes[root.id] ?? 0) + file.bytes;
      files += 1;
      bytes += file.bytes;
      const now = Date.now();
      if (now - lastPost >= PROGRESS_MS) {
        lastPost = now;
        post({ type: 'progress', progress: { root: root.id, files, bytes } });
      }
    });
  }
  const categories = STORAGE_CATEGORY_IDS.map((id) => {
    const bucket = acc.get(id) as { bytes: number; files: number; entries: Map<string, number> };
    return {
      id,
      bytes: bucket.bytes,
      files: bucket.files,
      entries: [...bucket.entries]
        .sort((a, b) => b[1] - a[1])
        .slice(0, ENTRY_LIMIT)
        .map(([key, b]) => ({
          root: entryRoot.get(key) ?? 'data',
          path: key.slice(key.indexOf(':') + 1),
          bytes: b,
        })),
    };
  });
  return {
    categories,
    rootBytes,
    sessionBytes: [...sessionBytes],
    errorCount: errors.count,
    errors: errors.samples,
  };
}

async function collect(data: Extract<StorageWorkerData, { mode: 'collect' }>) {
  const files: CleanCandidateFile[] = [];
  await walk(data.root, false, { count: 0, samples: [] }, (file) => files.push(file));
  return pickCleanTargets(files, {
    category: data.category,
    now: data.now,
    owner: sessionStorageOwner(data.refs),
    classify: (rel) => classifyStoragePath(rel, data.browserDir),
    indexReady: data.indexReady,
  });
}

function post(message: StorageWorkerMessage): void {
  parentPort?.postMessage(message);
}

const input = workerData as StorageWorkerData;
(input.mode === 'scan'
  ? scan(input).then((result) => post({ type: 'scan-done', result }))
  : collect(input).then(({ targets, skipped }) => post({ type: 'collect-done', targets, skipped }))
).catch((error: unknown) =>
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
);
