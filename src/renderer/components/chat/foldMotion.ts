import type { TimelineItem } from '@/stores/sessions/timeline';

export interface FoldMotionState {
  rows: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
}

export const EMPTY_FOLD_MOTION: FoldMotionState = { rows: new Set(), expanded: new Set() };

/**
 * 对比上一帧折叠行，找出探后折叠组的动效时机：
 * 刚配对（上一帧 mark 与 fold 还平铺）或手动收起 → 从折前跨度缩回；刚展开 → 子行按序揭示。
 * measure(from, to) 返回上一帧两行之间的像素跨度，量不到返回 0。
 */
export function diffFoldMotion(
  prev: FoldMotionState,
  folded: TimelineItem[],
  measure: (from: string, to: string) => number
) {
  const collapses: Array<{ key: string; height: number; pair: boolean }> = [];
  const expands: string[] = [];
  const children = new Map<string, { group: string; index: number }>();
  const expanded = new Set<string>();
  for (const item of folded) {
    if (item.kind !== 'tool-group' || !item.explore) continue;
    const shown = prev.rows.has(item.key);
    if (item.expanded) {
      expanded.add(item.key);
      if (shown && !prev.expanded.has(item.key)) expands.push(item.key);
      item.children.forEach((child, index) => {
        children.set(child.key, { group: item.key, index });
      });
      continue;
    }
    const first = item.children[0]?.key ?? '';
    const last = item.children.at(-1)?.key ?? '';
    const pair = !shown && prev.rows.has(first) && prev.rows.has(last);
    if (!pair && !prev.expanded.has(item.key)) continue;
    const height = measure(pair ? first : item.key, last);
    if (height > 0) collapses.push({ key: item.key, height, pair });
  }
  return {
    collapses,
    expands,
    children,
    next: { rows: new Set(folded.map((item) => item.key)), expanded } as FoldMotionState,
  };
}
