/** UIA ControlType → 现有 AX 角色名，让 walk 预算 / 空包装折叠沿用 mac 规则。 */
const UIA_CONTROL_TYPE_TO_AX: Record<number, string> = {
  50000: 'AXButton',
  50001: 'AXGroup',
  50002: 'AXCheckBox',
  50003: 'AXPopUpButton',
  50004: 'AXTextField',
  50005: 'AXLink',
  50006: 'AXImage',
  50007: 'AXRow',
  50008: 'AXList',
  50009: 'AXMenu',
  50010: 'AXMenuBar',
  50011: 'AXMenuItem',
  50012: 'AXProgressIndicator',
  50013: 'AXRadioButton',
  50014: 'AXScrollBar',
  50015: 'AXSlider',
  50016: 'AXIncrementor',
  50017: 'AXGroup',
  50018: 'AXTabGroup',
  50019: 'AXRadioButton',
  50020: 'AXStaticText',
  50021: 'AXToolbar',
  50022: 'AXHelpTag',
  50023: 'AXOutline',
  50024: 'AXRow',
  50025: 'AXUnknown',
  50026: 'AXGroup',
  50027: 'AXUnknown',
  50028: 'AXTable',
  50029: 'AXRow',
  50030: 'AXGroup',
  50031: 'AXMenuButton',
  50032: 'AXWindow',
  50033: 'AXGroup',
  50034: 'AXGroup',
  50035: 'AXCell',
  50036: 'AXTable',
  50037: 'AXGroup',
  50038: 'AXSplitter',
  50039: 'AXGroup',
};

export function uiaControlTypeToAxRole(controlType: number): string {
  return UIA_CONTROL_TYPE_TO_AX[controlType] ?? 'AXUnknown';
}

export function uiaPatternActions(patterns: {
  invoke?: boolean;
  toggle?: boolean;
  expandCollapse?: boolean;
}): string[] {
  const actions: string[] = [];
  if (patterns.invoke || patterns.toggle) actions.push('press');
  if (patterns.expandCollapse) actions.push('AXExpand', 'AXCollapse');
  return actions;
}

export type UiaNormalizedAction = 'press' | 'expand' | 'collapse';

export function uiaNormalizeAction(action: string): UiaNormalizedAction | null {
  const key = action.replace(/^AX/iu, '').toLowerCase();
  if (key === 'press' || key === 'invoke' || key === 'confirm') return 'press';
  if (key === 'expand') return 'expand';
  if (key === 'collapse') return 'collapse';
  return null;
}
