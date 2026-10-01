import { describe, expect, it } from 'vitest';
import { collectAxRoots } from './axRoots';

describe('collectAxRoots', () => {
  it('AXWindows 有窗口就用，不再找 Focused', () => {
    const roots = collectAxRoots((attr) => (attr === 'AXWindows' ? ['w1'] : ['focused']));
    expect(roots).toEqual(['w1']);
  });

  it('AXWindows 空数组时改用 AXMainWindow / AXFocusedWindow', () => {
    const roots = collectAxRoots((attr) => {
      if (attr === 'AXFocusedWindow') return ['focused'];
      return [];
    });
    expect(roots).toEqual(['focused']);
  });

  it('窗口属性都空时用应用 AXChildren（System Settings 常见）', () => {
    const roots = collectAxRoots((attr) => (attr === 'AXChildren' ? ['sidebar', 'pane'] : []));
    expect(roots).toEqual(['sidebar', 'pane']);
  });
});
