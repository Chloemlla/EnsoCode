import { type SessionCleanRequest, sessionCleanIds } from '@shared/resources';
import { useSessionsStore } from './index';
import { lastActiveAt } from './pinned';

const SETTLE_TIMEOUT_MS = 30_000;

/** 设置 → 资源 发起的会话清理：选中后逐条走 removeConversation，等投影移除后返回删除数。 */
export async function runSessionClean(
  request: SessionCleanRequest,
  now = Date.now()
): Promise<number> {
  const { order, conversations, activeId } = useSessionsStore.getState();
  const candidates = order.flatMap((id) => {
    const c = conversations[id];
    if (!c || c.parentId) return [];
    // 批量清理不碰当前打开、运行中或等你处理的会话
    const busy =
      id === activeId ||
      c.status === 'running' ||
      c.spawning === true ||
      c.workspaceMigrating === true ||
      (c.pendingAsks?.length ?? 0) > 0 ||
      (c.pendingApprovals?.length ?? 0) > 0;
    if (busy && request.kind === 'stale') return [];
    return [
      {
        id,
        projectId: c.projectId,
        archived: c.archived,
        archivedAt: c.archivedAt,
        pinned: c.pinned,
        lastActiveAt: lastActiveAt(c),
      },
    ];
  });
  const ids = sessionCleanIds(candidates, request, now);
  const store = useSessionsStore.getState();
  for (const id of ids) store.removeConversation(id);
  // worktree 会话先异步清理 worktree 再移除，等投影里消失
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  const remaining = () => ids.filter((id) => useSessionsStore.getState().conversations[id]);
  while (remaining().length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return ids.length - remaining().length;
}
