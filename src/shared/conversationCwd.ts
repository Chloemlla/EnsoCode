import path from 'node:path';

const CONVERSATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 会话工作目录。scratch 固定为 `<根>/<会话 id>`，并拒绝非法 id 与越界结果。 */
export function conversationCwd(input: {
  kind?: string;
  canonicalPath: string;
  conversationId: string;
  worktreePath?: string;
}): string | null {
  if (input.kind === 'scratch') {
    if (!input.canonicalPath || !CONVERSATION_ID.test(input.conversationId)) return null;
    const root = path.resolve(input.canonicalPath);
    const cwd = path.resolve(root, input.conversationId);
    if (path.relative(root, cwd) !== input.conversationId) return null;
    return cwd;
  }
  if (input.kind === 'ssh') return input.canonicalPath || null;
  if (input.worktreePath) return input.worktreePath;
  return input.canonicalPath || null;
}
