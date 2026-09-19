import { describe, expect, it } from 'vitest';
import { formatAxTree } from './axTree';

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
