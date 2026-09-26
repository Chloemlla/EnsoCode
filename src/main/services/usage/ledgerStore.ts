import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadUsageProjectAliases } from './aliases';
import { loadParsedSession, usageCacheDir } from './parseCache';
import { coerceParsedSession, type ParsedSession } from './parseSession';
import { applyUsageProjectAliases } from './projectLabel';

interface LedgerEntry {
  mtimeMs: number;
  size: number;
  session: ParsedSession | null;
}

/** 账本文件按 mtime/size 复用，避免每次打开用量页都重读全部快照 */
const ledgerMemory = new Map<string, LedgerEntry>();

export function usageLedgerDir(sessionDir: string): string {
  return path.join(path.dirname(sessionDir), 'usage-ledger');
}

function snapshotPath(dir: string, sessionId: string): string {
  return path.join(dir, `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

export async function writeLedgerSnapshot(
  sessionDir: string,
  parsed: ParsedSession
): Promise<void> {
  const dir = usageLedgerDir(sessionDir);
  await mkdir(dir, { recursive: true });
  const target = snapshotPath(dir, parsed.sessionId);
  await writeFile(target, JSON.stringify(parsed), 'utf8');
  ledgerMemory.delete(target);
}

/** 一轮结束后把当前 jsonl 的用量快照写入账本（覆盖该 sessionId）。文件缺失则忽略。 */
export async function ingestSessionJsonl(sessionDir: string, sessionFile: string): Promise<void> {
  const parsed = await loadParsedSession(sessionFile, usageCacheDir(sessionDir));
  if (parsed) {
    await writeLedgerSnapshot(
      sessionDir,
      applyUsageProjectAliases(parsed, loadUsageProjectAliases())
    );
  }
}

export async function loadLedger(sessionDir: string): Promise<ParsedSession[]> {
  const dir = usageLedgerDir(sessionDir);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const files = new Set(names.map((name) => path.join(dir, name)));
  for (const file of ledgerMemory.keys()) {
    if (path.dirname(file) === dir && !files.has(file)) ledgerMemory.delete(file);
  }
  const sessions: ParsedSession[] = [];
  for (const file of files) {
    const session = await loadLedgerFile(file);
    if (session) sessions.push(session);
  }
  return sessions;
}

async function loadLedgerFile(file: string): Promise<ParsedSession | null> {
  let mtimeMs: number;
  let size: number;
  try {
    ({ mtimeMs, size } = await stat(file));
  } catch {
    return null;
  }
  const hit = ledgerMemory.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.session;
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  let session: ParsedSession | null = null;
  try {
    session = coerceParsedSession(JSON.parse(text));
  } catch {}
  ledgerMemory.set(file, { mtimeMs, size, session });
  return session;
}
