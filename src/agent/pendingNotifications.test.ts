import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PendingNotificationStore, pendingNotificationFile } from './pendingNotifications';

const dir = () => path.join(mkdtempSync(path.join(tmpdir(), 'enso-pending-')), 'pending');

describe('PendingNotificationStore', () => {
  it('保存后可读回，子会话 id 编码进文件名', () => {
    const root = dir();
    const store = new PendingNotificationStore(root);
    store.save('conv-1::cw-a', ['task done', 'run finished']);
    expect(new PendingNotificationStore(root).load('conv-1::cw-a')).toEqual([
      'task done',
      'run finished',
    ]);
    expect(readdirSync(root)).toEqual([
      path.basename(pendingNotificationFile(root, 'conv-1::cw-a')),
    ]);
    expect(readdirSync(root)[0]).not.toContain(':');
  });

  it('清空即删除文件；不存在、损坏或脏数据都按空处理', () => {
    const root = dir();
    const store = new PendingNotificationStore(root);
    store.save('s', ['x']);
    store.save('s', []);
    expect(readdirSync(root)).toEqual([]);
    expect(store.load('missing')).toEqual([]);
    writeFileSync(pendingNotificationFile(root, 'bad'), '{oops');
    expect(store.load('bad')).toEqual([]);
    writeFileSync(pendingNotificationFile(root, 'mixed'), JSON.stringify(['ok', 1, null, '']));
    expect(store.load('mixed')).toEqual(['ok']);
  });

  it('目录不可写时不抛错', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'enso-pending-')), 'blocker');
    writeFileSync(file, '');
    const store = new PendingNotificationStore(path.join(file, 'nested'));
    expect(() => store.save('s', ['x'])).not.toThrow();
    expect(store.load('s')).toEqual([]);
  });
});
