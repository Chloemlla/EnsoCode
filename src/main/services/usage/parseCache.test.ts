import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const header = (id: string) =>
  `${JSON.stringify({ type: 'session', version: 3, id, timestamp: 't', cwd: '/p/demo' })}\n`;

/** 模拟应用重启：丢弃模块级内存缓存 */
async function freshCache() {
  vi.resetModules();
  return import('./parseCache');
}

describe('usage 解析磁盘缓存', () => {
  let root: string;
  let cacheDir: string;
  let file: string;
  const mtime = 1_800_000_000;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-usage-cache-'));
    cacheDir = path.join(root, 'usage-cache');
    file = path.join(root, 'a.jsonl');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeSession(id: string) {
    fs.writeFileSync(file, header(id));
    fs.utimesSync(file, mtime, mtime);
  }

  it('重启后 jsonl 的 mtime/size 未变时直接用磁盘缓存，不重新解析原文', async () => {
    writeSession('s1');
    expect((await (await freshCache()).loadParsedSession(file, cacheDir))?.sessionId).toBe('s1');
    // 同长度改写并还原 mtime：若重新解析会读到 s2
    writeSession('s2');
    expect((await (await freshCache()).loadParsedSession(file, cacheDir))?.sessionId).toBe('s1');
  });

  it('mtime 变化后缓存失效并重新解析', async () => {
    writeSession('s1');
    await (await freshCache()).loadParsedSession(file, cacheDir);
    fs.writeFileSync(file, header('s2'));
    fs.utimesSync(file, mtime + 10, mtime + 10);
    expect((await (await freshCache()).loadParsedSession(file, cacheDir))?.sessionId).toBe('s2');
  });

  it('缓存文件损坏时回退解析原文', async () => {
    writeSession('s1');
    await (await freshCache()).loadParsedSession(file, cacheDir);
    for (const name of fs.readdirSync(cacheDir)) {
      fs.writeFileSync(path.join(cacheDir, name), '{bad json');
    }
    expect((await (await freshCache()).loadParsedSession(file, cacheDir))?.sessionId).toBe('s1');
  });

  it('jsonl 不存在时返回 null 且不写缓存', async () => {
    expect(await (await freshCache()).loadParsedSession(file, cacheDir)).toBeNull();
    expect(fs.existsSync(cacheDir)).toBe(false);
  });
});
