import { describe, expect, it } from 'vitest';
import {
  AX_SNAPSHOT_BUDGET_MS,
  AX_SNAPSHOT_DEFAULT_DEPTH,
  AX_SNAPSHOT_MAX_NODES,
  axCollectVisibleText,
  axFillEmptyRowTitle,
  axNextDepth,
  axRowTitleFromCells,
  axShouldExpand,
  axWalkDecision,
} from './axWalkBudget';

describe('axWalkDecision', () => {
  it('默认只走根 + 一层有意义节点，并限制节点和时间', () => {
    expect(AX_SNAPSHOT_DEFAULT_DEPTH).toBe(1);
    expect(AX_SNAPSHOT_MAX_NODES).toBe(80);
    expect(AX_SNAPSHOT_BUDGET_MS).toBe(2500);
  });

  it('超时和节点预算分开', () => {
    expect(axWalkDecision({ startedAt: 0, nodeCount: 1, now: 2500 })).toBe('timeout');
    expect(axWalkDecision({ startedAt: 0, nodeCount: 80, now: 10 })).toBe('budget');
    expect(axWalkDecision({ startedAt: 0, nodeCount: 2, now: 10 })).toBe('continue');
  });
});

describe('ax walk depth', () => {
  it('Group/ScrollArea 不占深度，Outline 会展开到行', () => {
    expect(axNextDepth('AXGroup', 1)).toBe(1);
    expect(axNextDepth('AXSplitGroup', 1)).toBe(1);
    expect(axNextDepth('AXScrollArea', 1)).toBe(1);
    expect(axNextDepth('AXButton', 1)).toBe(2);
    expect(axShouldExpand('AXWindow', 0, 1)).toBe(true);
    expect(axShouldExpand('AXGroup', 1, 1)).toBe(true);
    expect(axShouldExpand('AXOutline', 1, 1)).toBe(true);
    expect(axShouldExpand('AXTable', 1, 1)).toBe(true);
    expect(axShouldExpand('AXPopUpButton', 2, 1)).toBe(true);
    expect(axShouldExpand('AXMenuButton', 2, 1)).toBe(true);
    expect(axShouldExpand('AXButton', 1, 1)).toBe(false);
    expect(axShouldExpand('AXRow', 2, 1)).toBe(false);
    expect(axShouldExpand('AXSheet', 1, 1)).toBe(true);
    expect(axNextDepth('AXSheet', 1)).toBe(1);
  });

  it('Row 无自身 title 时用 cell 文本', () => {
    expect(axRowTitleFromCells(undefined, undefined, ['EnsoCode', '12.3', '482'])).toBe(
      'EnsoCode 12.3 482'
    );
    expect(axRowTitleFromCells('已有', undefined, ['EnsoCode'])).toBeUndefined();
  });
});

describe('empty AXRow labels', () => {
  it('从嵌套 StaticText 抽出侧栏可见字', () => {
    const row = {
      ref: 'e9',
      role: 'AXRow',
      children: [
        {
          ref: 'e10',
          role: 'AXCell',
          children: [
            {
              ref: 'e11',
              role: 'AXGroup',
              children: [{ ref: 'e12', role: 'AXStaticText', value: '外观' }],
            },
          ],
        },
      ],
    };
    expect(axCollectVisibleText(row)).toEqual(['外观']);
    axFillEmptyRowTitle(row);
    expect(row.title).toBe('外观');
  });
});
