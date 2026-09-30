import { describe, expect, it } from 'vitest';
import { uiaControlTypeToAxRole, uiaNormalizeAction, uiaPatternActions } from './winUiaMap';

describe('uiaControlTypeToAxRole', () => {
  it('把常见 UIA ControlType 映射成 AX 角色名', () => {
    expect(uiaControlTypeToAxRole(50000)).toBe('AXButton');
    expect(uiaControlTypeToAxRole(50004)).toBe('AXTextField');
    expect(uiaControlTypeToAxRole(50020)).toBe('AXStaticText');
    expect(uiaControlTypeToAxRole(50032)).toBe('AXWindow');
    expect(uiaControlTypeToAxRole(50008)).toBe('AXList');
    expect(uiaControlTypeToAxRole(50007)).toBe('AXRow');
    expect(uiaControlTypeToAxRole(50023)).toBe('AXOutline');
    expect(uiaControlTypeToAxRole(50024)).toBe('AXRow');
    expect(uiaControlTypeToAxRole(50026)).toBe('AXGroup');
    expect(uiaControlTypeToAxRole(1)).toBe('AXUnknown');
  });
});

describe('uiaPatternActions', () => {
  it('Invoke/Toggle 暴露 press，ExpandCollapse 暴露 expand/collapse', () => {
    expect(uiaPatternActions({ invoke: true })).toEqual(['press']);
    expect(uiaPatternActions({ toggle: true })).toEqual(['press']);
    expect(uiaPatternActions({ invoke: true, toggle: true })).toEqual(['press']);
    expect(uiaPatternActions({ expandCollapse: true })).toEqual(['AXExpand', 'AXCollapse']);
    expect(uiaPatternActions({})).toEqual([]);
  });
});

describe('uiaNormalizeAction', () => {
  it('press/AXPress/invoke 都当成 press', () => {
    expect(uiaNormalizeAction('press')).toBe('press');
    expect(uiaNormalizeAction('AXPress')).toBe('press');
    expect(uiaNormalizeAction('invoke')).toBe('press');
    expect(uiaNormalizeAction('AXExpand')).toBe('expand');
    expect(uiaNormalizeAction('collapse')).toBe('collapse');
    expect(uiaNormalizeAction('nope')).toBe(null);
  });
});
