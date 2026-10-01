import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { RunawayGuard, runawayReminderText, withRunawayGuard } from './runawayGuard';

function textTool(
  name: string,
  run: (params: unknown) => { text: string; isError?: boolean }
): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
    async execute(_id, params) {
      const result = run(params);
      return {
        content: [{ type: 'text' as const, text: result.text }],
        details: undefined,
        ...(result.isError ? { isError: true as const } : {}),
      };
    },
  };
}

describe('RunawayGuard', () => {
  it('连续三次相同工具和参数才提醒，只提醒一次', () => {
    const guard = new RunawayGuard();
    const args = { path: 'a.ts' };
    expect(guard.observe('read', args, { text: '1' })).toBeUndefined();
    expect(guard.observe('read', args, { text: '2' })).toBeUndefined();
    const reminder = guard.observe('read', args, { text: '3' });
    expect(reminder).toContain('[runaway guard]');
    expect(reminder).toContain('same arguments');
    expect(guard.observe('read', args, { text: '4' })).toBeUndefined();
  });

  it('换工具或换参数会打断动作连击', () => {
    const guard = new RunawayGuard();
    const args = { path: 'a.ts' };
    guard.observe('read', args, { text: '1' });
    guard.observe('read', args, { text: '2' });
    guard.observe('grep', { pattern: 'x' }, { text: '3' });
    expect(guard.observe('read', args, { text: '4' })).toBeUndefined();
    expect(guard.observe('read', args, { text: '5' })).toBeUndefined();
    expect(guard.observe('read', args, { text: '6' })).toContain('same arguments');
  });

  it('computer 相同 code 但截图 hash 变了不算 runaway', () => {
    const guard = new RunawayGuard();
    const args = { code: 'await win.screenshot()' };
    expect(guard.observe('computer', args, { text: 'hash a' })).toBeUndefined();
    expect(guard.observe('computer', args, { text: 'hash b' })).toBeUndefined();
    expect(guard.observe('computer', args, { text: 'hash c' })).toBeUndefined();
  });

  it('computer 三次相同结果文本才算无进展', () => {
    const guard = new RunawayGuard();
    const args = { code: 'await win.screenshot()' };
    const snap = { text: 'w1 10×10 hash deadbeef' };
    expect(guard.observe('computer', args, snap)).toBeUndefined();
    expect(guard.observe('computer', args, snap)).toBeUndefined();
    expect(guard.observe('computer', args, snap)).toContain('no observable progress');
  });

  it('同一错误家族连续三次提醒', () => {
    const guard = new RunawayGuard();
    const args = { command: 'npm test' };
    const err = { text: 'ENOENT: no such file', isError: true };
    expect(guard.observe('bash', args, err)).toBeUndefined();
    expect(guard.observe('bash', { command: 'npm test -- --run' }, err)).toBeUndefined();
    expect(guard.observe('bash', { command: 'pnpm test' }, err)).toContain('same error');
  });

  it('task_output 轮询无进展三次提醒，且禁止写入 Memory', () => {
    const guard = new RunawayGuard();
    const args = { taskId: 'task-1' };
    const snap = { text: '[running] Full log: /tmp/x\n(no output yet)' };
    expect(guard.observe('task_output', args, snap)).toBeUndefined();
    expect(guard.observe('task_output', args, snap)).toBeUndefined();
    const reminder = guard.observe('task_output', args, snap);
    expect(reminder).toContain('task_output');
    expect(reminder).toMatch(/notified automatically/i);
    expect(reminder).toMatch(/Do not save/i);
  });

  it('resetTurn 后可以再提醒', () => {
    const guard = new RunawayGuard();
    const args = { path: 'a.ts' };
    guard.observe('read', args, { text: '1' });
    guard.observe('read', args, { text: '2' });
    expect(guard.observe('read', args, { text: '3' })).toBeTruthy();
    guard.resetTurn();
    guard.observe('read', args, { text: '1' });
    guard.observe('read', args, { text: '2' });
    expect(guard.observe('read', args, { text: '3' })).toContain('same arguments');
  });

  it('withRunawayGuard 把提醒垫到工具结果顶部', async () => {
    const guard = new RunawayGuard();
    let n = 0;
    const wrapped = withRunawayGuard(
      textTool('read', () => ({ text: `body-${++n}` })),
      guard
    );
    const args = { path: 'a.ts' };
    await wrapped.execute('1', args, undefined, undefined, undefined as never);
    await wrapped.execute('2', args, undefined, undefined, undefined as never);
    const third = await wrapped.execute('3', args, undefined, undefined, undefined as never);
    const text = third.content[0];
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text.startsWith(runawayReminderText('exact_action_repeat'))).toBe(true);
      expect(text.text).toContain('body');
    }
  });
});
