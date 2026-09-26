import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coerceParsedSession, type ParsedSession, parseSessionJsonl } from './parseSession';

/** parser 输出语义变化时递增，旧缓存整体失效 */
const CACHE_VERSION = 1;
const CACHE_SUFFIX = '.json';

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedSession | null;
}

const memory = new Map<string, CacheEntry>();
let tmpSeq = 0;

export function usageCacheDir(sessionDir: string): string {
  return path.join(path.dirname(sessionDir), 'usage-cache');
}

function cachePath(cacheDir: string, file: string): string {
  return path.join(cacheDir, `${path.basename(file)}${CACHE_SUFFIX}`);
}

async function readDiskEntry(
  target: string,
  mtimeMs: number,
  size: number
): Promise<CacheEntry | null> {
  try {
    const raw = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown> | null;
    if (raw?.v !== CACHE_VERSION || raw.mtimeMs !== mtimeMs || raw.size !== size) return null;
    if (raw.parsed === null) return { mtimeMs, size, parsed: null };
    const parsed = coerceParsedSession(raw.parsed);
    return parsed ? { mtimeMs, size, parsed } : null;
  } catch {
    return null;
  }
}

async function writeDiskEntry(target: string, entry: CacheEntry): Promise<void> {
  const tmp = `${target}.${process.pid}-${tmpSeq++}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(tmp, JSON.stringify({ v: CACHE_VERSION, ...entry }), 'utf8');
    await rename(tmp, target);
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * jsonl 解析结果按 mtime/size 复用：内存 → 磁盘缓存 → 全量解析并回写。
 * 磁盘层让重启后不必重读 GB 级会话原文；stat 在读原文之前，读到更新内容只会导致下次多解析一次。
 */
export async function loadParsedSession(
  file: string,
  cacheDir: string
): Promise<ParsedSession | null> {
  let mtimeMs: number;
  let size: number;
  try {
    ({ mtimeMs, size } = await stat(file));
  } catch {
    return null;
  }
  const hit = memory.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.parsed;
  const target = cachePath(cacheDir, file);
  let entry = await readDiskEntry(target, mtimeMs, size);
  if (!entry) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return null;
    }
    entry = { mtimeMs, size, parsed: parseSessionJsonl(text) };
    await writeDiskEntry(target, entry);
  }
  memory.set(file, entry);
  return entry.parsed;
}

/** 清掉已不存在的 jsonl 对应的内存与磁盘缓存 */
export async function pruneParseCache(cacheDir: string, files: readonly string[]): Promise<void> {
  const live = new Set(files);
  for (const file of memory.keys()) {
    if (!live.has(file)) memory.delete(file);
  }
  const keep = new Set(files.map((file) => path.basename(cachePath(cacheDir, file))));
  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith(`.jsonl${CACHE_SUFFIX}`) && !keep.has(name))
      .map((name) => rm(path.join(cacheDir, name), { force: true }).catch(() => {}))
  );
}
