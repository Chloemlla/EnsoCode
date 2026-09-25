import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TodoItem } from '@shared/types/agent';

const STATUSES = ['pending', 'in_progress', 'completed'] as const;

/** 整表替换语义（Claude Code TodoWrite）：渲染层只需读最后一条 todo toolResult */
const PARAMETERS = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      description: 'The full updated todo list (replaces the previous list entirely)',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Task description' },
          status: { type: 'string', enum: [...STATUSES] },
        },
        required: ['content', 'status'],
      },
    },
  },
  required: ['todos'],
} as unknown as ToolDefinition['parameters'];

const isTodo = (value: unknown): value is TodoItem =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as TodoItem).content === 'string' &&
  STATUSES.includes((value as TodoItem).status);

const formatTodos = (todos: TodoItem[]) =>
  todos
    .map(
      (todo) =>
        `[${todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '~' : ' '}] ${todo.content}`
    )
    .join('\n');

export const TODO_STALE_TOOL_CALLS = 8;

/**
 * 清单有未完成项、且自上次 todo 起已过 threshold 次工具调用（含 todo 自身）时产出提醒；
 * take() 由 SystemReminderRegistry 在每次工具调用后调用，提醒后重新计数避免逐次唠叨。
 */
export class TodoStaleReminder {
  private todos: TodoItem[] = [];
  private calls = 0;

  constructor(private readonly threshold = TODO_STALE_TOOL_CALLS) {}

  update(todos: TodoItem[]): void {
    this.todos = todos;
    this.calls = 0;
  }

  take(): string[] {
    if (!this.todos.some((todo) => todo.status !== 'completed')) return [];
    this.calls += 1;
    if (this.calls <= this.threshold) return [];
    this.calls = 0;
    return [
      `The todo list has not been updated in the last ${this.threshold} tool calls. ` +
        'If a step has finished, call todo now: mark it completed and the next step in_progress. ' +
        'If the plan changed, revise the list; if it no longer applies, clear it. ' +
        'Do not mention this reminder to the user.\n\n' +
        `Current list:\n${formatTodos(this.todos)}`,
    ];
  }
}

/**
 * 会话内任务清单工具。状态随 toolResult.details 写进会话 jsonl——
 * resume/branch 时读最后一条 todo toolResult 即为当前状态，无需外部存储。
 */
export function createTodoTool(onUpdate?: (todos: TodoItem[]) => void): ToolDefinition {
  return {
    name: 'todo',
    label: 'Todo',
    description:
      'Update the task list for the current session. Pass the FULL list every time (it replaces the previous one). ' +
      'Use for multi-step tasks: mark the current step in_progress (only one at a time), completed steps completed. ' +
      'Call it again as soon as each step finishes (mark it completed and the next one in_progress); ' +
      'never batch several steps into one update or leave the list stale while working. ' +
      'Revise the list right away when the plan changes. ' +
      'Skip it for trivial single-step requests.',
    promptSnippet: 'todo: track multi-step work; update the list as soon as each step finishes',
    promptGuidelines: [
      'Call todo as soon as each step finishes (mark it completed and the next one in_progress); do not wait until the end or batch several steps into one update.',
      'Before the final response, make sure the todo list reflects reality: finished steps completed, abandoned steps removed.',
    ],
    parameters: PARAMETERS,
    async execute(_toolCallId, params) {
      const raw = (params as { todos?: unknown }).todos;
      const todos = Array.isArray(raw) ? raw.filter(isTodo) : [];
      onUpdate?.(todos);
      const done = todos.filter((todo) => todo.status === 'completed').length;
      return {
        content: [
          {
            type: 'text',
            text:
              todos.length > 0
                ? `Todos (${done}/${todos.length} done):\n${formatTodos(todos)}`
                : 'Todo list cleared',
          },
        ],
        details: { todos },
      };
    },
  };
}
