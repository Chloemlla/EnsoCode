import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conversationCwd } from './conversationCwd';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('conversationCwd', () => {
  it('普通项目用项目路径，有 worktree 时用 worktree', () => {
    expect(conversationCwd({ kind: 'local', canonicalPath: '/repo', conversationId: ID })).toBe(
      '/repo'
    );
    expect(
      conversationCwd({
        kind: 'local',
        canonicalPath: '/repo',
        conversationId: ID,
        worktreePath: '/worktrees/feature',
      })
    ).toBe('/worktrees/feature');
  });

  it('ssh 只用远端项目路径', () => {
    expect(
      conversationCwd({
        kind: 'ssh',
        canonicalPath: '/remote/app',
        conversationId: ID,
        worktreePath: '/worktrees/feature',
      })
    ).toBe('/remote/app');
  });

  it('scratch 会话目录是根目录下的会话 id，忽略 worktree', () => {
    const root = path.resolve('/data/scratch');
    expect(
      conversationCwd({
        kind: 'scratch',
        canonicalPath: root,
        conversationId: ID,
        worktreePath: path.join(root, OTHER),
      })
    ).toBe(path.join(root, ID));
  });

  it('scratch 拒绝非法 id 和越界结果', () => {
    const root = path.resolve('/data/scratch');
    for (const conversationId of ['', 'not-a-uuid', `../${ID}`, `${ID}/escape`, '..']) {
      expect(conversationCwd({ kind: 'scratch', canonicalPath: root, conversationId })).toBeNull();
    }
    expect(conversationCwd({ kind: 'scratch', canonicalPath: root, conversationId: OTHER })).toBe(
      path.join(root, OTHER)
    );
    expect(conversationCwd({ kind: 'scratch', canonicalPath: '', conversationId: ID })).toBeNull();
  });
});
