import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBotSessionSummary } from './sessionMessages';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

describe('readBotSessionSummary', () => {
  it('标题取首条用户消息，时间取文件修改时间；目录外或缺文件返回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-summary-'));
    dirs.push(dir);
    const file = join(dir, 's.jsonl');
    writeFileSync(
      file,
      line({ type: 'session', id: 'h' }) +
        line({ type: 'message', id: 'a', message: { role: 'assistant', content: 'hi' } }) +
        line({
          type: 'message',
          id: 'u',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '<notes-updated>n</notes-updated>\n整理发布清单' }],
          },
        }) +
        line({ type: 'message', id: 'v', message: { role: 'user', content: '第二条' } })
    );
    const summary = await readBotSessionSummary(dir, file);
    expect(summary?.title).toBe('整理发布清单');
    expect(summary?.activityAt).toBeGreaterThan(0);

    const empty = join(dir, 'e.jsonl');
    writeFileSync(empty, line({ type: 'session', id: 'h' }));
    expect((await readBotSessionSummary(dir, empty))?.title).toBeUndefined();
    expect(await readBotSessionSummary(dir, join(dir, 'missing.jsonl'))).toBeNull();
    expect(await readBotSessionSummary(dir, join(tmpdir(), 'x.jsonl'))).toBeNull();
    expect(await readBotSessionSummary(dir, undefined)).toBeNull();
  });
});
