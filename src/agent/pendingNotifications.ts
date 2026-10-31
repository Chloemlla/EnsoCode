import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 子会话 id 含 `::`，编码后才能当文件名；清理侧按同一规则解码匹配 */
export function pendingNotificationFile(dir: string, sessionId: string): string {
  return path.join(dir, `${encodeURIComponent(sessionId)}.json`);
}

/**
 * 未投递的完成通知落盘：worker 重启或应用退出时会话正忙、通知还挂在 pending 里，
 * 下次打开会话时恢复进 pending，随下一次工具结果或回合收口补投。全程 best-effort。
 */
export class PendingNotificationStore {
  constructor(private readonly dir: string) {}

  load(sessionId: string): string[] {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(pendingNotificationFile(this.dir, sessionId), 'utf8')
      );
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  save(sessionId: string, texts: readonly string[]): void {
    const file = pendingNotificationFile(this.dir, sessionId);
    try {
      if (texts.length === 0) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(texts));
      renameSync(tmp, file);
    } catch (error) {
      console.warn(`[notify] failed to persist pending notifications for ${sessionId}:`, error);
    }
  }
}
