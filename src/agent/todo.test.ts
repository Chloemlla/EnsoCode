import type { TodoItem } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { createTodoTool, TodoStaleReminder } from './todo';

const open: TodoItem[] = [
  { content: 'write tests', status: 'completed' },
  { content: 'implement', status: 'in_progress' },
  { content: 'commit', status: 'pending' },
];

const takeTimes = (reminder: TodoStaleReminder, times: number) =>
  Array.from({ length: times }, () => reminder.take());

describe('TodoStaleReminder', () => {
  it('没有清单时从不提醒', () => {
    const reminder = new TodoStaleReminder(2);
    expect(takeTimes(reminder, 10).flat()).toEqual([]);
  });

  it('有未完成项且更新后已过 N 次调用，才提醒并带上当前清单', () => {
    const reminder = new TodoStaleReminder(2);
    reminder.update(open);
    // todo 调用自身 + 1 次其他调用：尚未陈旧
    expect(takeTimes(reminder, 2).flat()).toEqual([]);
    const [text] = reminder.take();
    expect(text).toContain('todo');
    expect(text).toContain('[x] write tests\n[~] implement\n[ ] commit');
  });

  it('更新清单会重新计数', () => {
    const reminder = new TodoStaleReminder(2);
    reminder.update(open);
    takeTimes(reminder, 2);
    reminder.update(open);
    expect(takeTimes(reminder, 2).flat()).toEqual([]);
  });

  it('提醒后不会每次调用都重复，隔一个周期再提醒', () => {
    const reminder = new TodoStaleReminder(2);
    reminder.update(open);
    takeTimes(reminder, 2);
    expect(reminder.take()).toHaveLength(1);
    expect(takeTimes(reminder, 2).flat()).toEqual([]);
    expect(reminder.take()).toHaveLength(1);
  });

  it('全部完成或清空后不提醒', () => {
    const reminder = new TodoStaleReminder(2);
    reminder.update(open.map((todo) => ({ ...todo, status: 'completed' as const })));
    expect(takeTimes(reminder, 10).flat()).toEqual([]);
    reminder.update([]);
    expect(takeTimes(reminder, 10).flat()).toEqual([]);
  });
});

describe('createTodoTool', () => {
  it('执行时把校验后的清单交给 onUpdate', async () => {
    const reminder = new TodoStaleReminder(1);
    const tool = createTodoTool((todos) => reminder.update(todos));
    await tool.execute(
      'call-1',
      { todos: [...open, { content: 'bad', status: 'unknown' }] },
      undefined,
      undefined,
      undefined as never
    );
    reminder.take();
    const [text] = reminder.take();
    expect(text).toContain('[ ] commit');
    expect(text).not.toContain('bad');
  });

  it('进入系统提示：工具简介与"每步完成即更新、结束前收尾"的规则', () => {
    const tool = createTodoTool();
    expect(tool.promptSnippet).toMatch(/^todo: /);
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';
    expect(guidelines).toMatch(/as soon as each step finishes/i);
    expect(guidelines).toMatch(/final response/i);
  });
});
