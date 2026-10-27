import { type ConversationsPatch, mergeConversationOrder } from '@shared/conversationsPatch';
import { RUNTIME_CONVERSATION_KEYS } from './persistSnapshot';

const RUNTIME_KEYS: ReadonlySet<string> = new Set(RUNTIME_CONVERSATION_KEYS);

interface PatchTarget<C> {
  conversations: Record<string, C>;
  order: string[];
  activeId: string | null;
}

export function applyConversationsPatchToState<C extends object>(
  state: PatchTarget<C>,
  patch: ConversationsPatch
): PatchTarget<C> {
  const conversations = { ...state.conversations };
  for (const id of patch.removes) delete conversations[id];
  for (const [id, row] of Object.entries(patch.upserts)) {
    const current = conversations[id];
    if (!current) {
      // 本地已删/从未有过的会话只收到字段级差量时，拼不出完整会话，丢弃
      if (typeof row.set.id !== 'string') continue;
      conversations[id] = { ...row.set, messages: [] } as C;
      continue;
    }
    const merged: Record<string, unknown> = Object.fromEntries(Object.entries(current));
    for (const key of row.unset) if (!RUNTIME_KEYS.has(key)) delete merged[key];
    for (const [key, value] of Object.entries(row.set)) {
      if (!RUNTIME_KEYS.has(key)) merged[key] = value;
    }
    conversations[id] = merged as C;
  }
  const exists = (id: string) => id in conversations;
  const base = patch.order
    ? mergeConversationOrder(state.order, patch.order, exists)
    : state.order.filter(exists);
  const listed = new Set(base);
  const added = Object.keys(patch.upserts).filter((id) => exists(id) && !listed.has(id));
  const order = [...added, ...base];
  const activeId = state.activeId && !exists(state.activeId) ? (order[0] ?? null) : state.activeId;
  return { conversations, order, activeId };
}
