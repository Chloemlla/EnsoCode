import type { ProjectedMessage, TodoItem } from '@shared/types/agent';

/** todo 是整表替换：只看最后一份清单，仍有未完成项才固定显示 */
export function latestUnfinishedTodos(
  messages: readonly ProjectedMessage[]
): { id: string; todos: TodoItem[] } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'toolResult' || message.toolName !== 'todo' || !message.todos) continue;
    return message.todos.some((todo) => todo.status !== 'completed')
      ? { id: message.toolCallId ?? String(index), todos: message.todos }
      : null;
  }
  return null;
}
