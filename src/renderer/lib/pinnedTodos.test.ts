import type { ProjectedMessage, TodoItem } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { latestUnfinishedTodos } from './pinnedTodos';

const todoResult = (id: string, todos: TodoItem[] | undefined): ProjectedMessage => ({
  role: 'toolResult',
  toolName: 'todo',
  toolCallId: id,
  content: [{ type: 'text', text: 'ok' }],
  ...(todos ? { todos } : {}),
});
const text = (role: string): ProjectedMessage => ({
  role,
  content: [{ type: 'text', text: 'x' }],
});
const pending = (content: string): TodoItem => ({ content, status: 'pending' });
const done = (content: string): TodoItem => ({ content, status: 'completed' });

describe('latestUnfinishedTodos', () => {
  it('取最后一次 todo 结果；仍有未完成项时返回', () => {
    const messages = [
      text('user'),
      todoResult('t1', [pending('a')]),
      text('assistant'),
      todoResult('t2', [done('a'), pending('b')]),
      text('assistant'),
    ];
    expect(latestUnfinishedTodos(messages)).toEqual({
      id: 't2',
      todos: [done('a'), pending('b')],
    });
  });

  it('最新清单已全部完成时不回退到更早的未完成清单', () => {
    const messages = [todoResult('t1', [pending('a')]), todoResult('t2', [done('a')])];
    expect(latestUnfinishedTodos(messages)).toBeNull();
  });

  it('没有 todo、空清单或其他工具结果不算', () => {
    expect(latestUnfinishedTodos([])).toBeNull();
    expect(latestUnfinishedTodos([todoResult('t1', [])])).toBeNull();
    expect(
      latestUnfinishedTodos([
        { ...todoResult('x', [pending('a')]), toolName: 'bash' },
        text('assistant'),
      ])
    ).toBeNull();
  });

  it('失败的 todo 调用（无清单快照）跳过，沿用上一份清单', () => {
    const messages = [todoResult('t1', [pending('a')]), todoResult('t2', undefined)];
    expect(latestUnfinishedTodos(messages)?.id).toBe('t1');
  });
});
