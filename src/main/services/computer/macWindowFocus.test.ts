import type { ComputerWindowInfo } from '@shared/computer/types';
import { describe, expect, it } from 'vitest';
import { withMacWindowFocus } from './macWindowFocus';

const windows: ComputerWindowInfo[] = [
  { id: 'overlay', pid: 1, app: 'Chat', title: '', x: 0, y: 0, width: 10, height: 10 },
  { id: 'settings', pid: 2, app: 'Settings', title: '', x: 0, y: 0, width: 500, height: 500 },
  { id: 'other', pid: 2, app: 'Settings', title: '', x: 0, y: 0, width: 500, height: 500 },
];

describe('withMacWindowFocus', () => {
  it('浮动窗口的层级顺序不能覆盖真实焦点窗口', () => {
    expect(
      withMacWindowFocus(windows, { pid: 2, windowId: 'settings' }).map((w) => w.focused)
    ).toEqual([false, true, false]);
  });

  it('焦点不可读取、窗口消失或 pid 不符时全部保持非焦点', () => {
    for (const focus of [
      undefined,
      { pid: 2, windowId: 'missing' },
      { pid: 1, windowId: 'settings' },
    ]) {
      expect(withMacWindowFocus(windows, focus).some((w) => w.focused)).toBe(false);
    }
  });

  it('不能保留上一份列表里的旧 focused 标记', () => {
    const previous = withMacWindowFocus(windows, { pid: 2, windowId: 'settings' });
    expect(withMacWindowFocus(previous).some((w) => w.focused)).toBe(false);
    expect(windows.every((w) => w.focused === undefined)).toBe(true);
  });
});
