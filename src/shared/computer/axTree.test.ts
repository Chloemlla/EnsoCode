import { describe, expect, it } from 'vitest';
import { formatAxTree, formatAxTreeDiff } from './axTree';

describe('formatAxTree', () => {
  it('输出带 [ref=eN] 的文本树', () => {
    const text = formatAxTree([
      {
        ref: 'e1',
        role: 'window',
        title: 'Settings',
        children: [{ ref: 'e2', role: 'button', title: 'Save', focused: true, actions: ['press'] }],
      },
    ]);
    expect(text).toContain('window [ref=e1] title="Settings"');
    expect(text).toContain('button [ref=e2] title="Save" focused actions=press');
  });
});

describe('formatAxTreeDiff', () => {
  it('只改 ref 视为 unchanged', () => {
    const a = 'button [ref=e1] title="Save"';
    const b = 'button [ref=e9] title="Save"';
    expect(formatAxTreeDiff(a, b)).toBe('(ax unchanged)');
  });

  it('新增行带当前 ref', () => {
    const prev = 'window [ref=e1] title="Settings"\n  button [ref=e2] title="Save"';
    const curr =
      'window [ref=e3] title="Settings"\n  button [ref=e4] title="Save"\n  button [ref=e5] title="Cancel"';
    const diff = formatAxTreeDiff(prev, curr);
    expect(diff).toContain('+');
    expect(diff).toContain('[ref=e5]');
    expect(diff).toContain('Cancel');
    expect(diff).not.toContain('Save');
  });
});
