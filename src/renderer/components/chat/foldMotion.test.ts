import { describe, expect, it } from 'vitest';
import { foldTimeline, type TimelineItem } from '@/stores/sessions/timeline';
import { diffFoldMotion, EMPTY_FOLD_MOTION } from './foldMotion';

const tool = (key: string, name: string, state: 'ok' | 'running' = 'ok'): TimelineItem => ({
  kind: 'tool',
  key,
  name,
  summary: key,
  output: null,
  state,
  edits: null,
  writeContent: null,
  todos: null,
  durationMs: null,
  agentMeta: null,
});
const user: TimelineItem = { kind: 'user', key: 'u', text: 'q', images: [] };
const live = [
  user,
  tool('m', 'explore_mark'),
  tool('r', 'read'),
  tool('f', 'explore_fold', 'running'),
];
const paired = [user, tool('m', 'explore_mark'), tool('r', 'read'), tool('f', 'explore_fold')];
const KEY = 'explore-m';

function measurer(height = 90) {
  const spans: string[] = [];
  const measure = (from: string, to: string) => {
    spans.push(`${from}->${to}`);
    return height;
  };
  return { spans, measure };
}

describe('diffFoldMotion', () => {
  it('刚配对：上一帧平铺的 mark 到 fold 收拢，从 mark 顶量到 fold 底', () => {
    const { spans, measure } = measurer();
    const first = diffFoldMotion(EMPTY_FOLD_MOTION, foldTimeline(live, true, new Set()), measure);
    expect(first.collapses).toEqual([]);
    const second = diffFoldMotion(first.next, foldTimeline(paired, true, new Set()), measure);
    expect(second.collapses).toEqual([{ key: KEY, height: 90, pair: true }]);
    expect(spans).toEqual(['m->f']);
  });

  it('手动展开时子行带组内序号；再收起从组头量到最后一行', () => {
    const { spans, measure } = measurer();
    const first = diffFoldMotion(
      EMPTY_FOLD_MOTION,
      foldTimeline(paired, false, new Set()),
      measure
    );
    expect(first.collapses).toEqual([]);
    const opened = diffFoldMotion(first.next, foldTimeline(paired, false, new Set([KEY])), measure);
    expect(opened.expands).toEqual([KEY]);
    expect(opened.children.get('r')).toEqual({ group: KEY, index: 1 });
    const closed = diffFoldMotion(opened.next, foldTimeline(paired, false, new Set()), measure);
    expect(closed.collapses).toEqual([{ key: KEY, height: 90, pair: false }]);
    expect(spans).toEqual([`${KEY}->f`]);
  });

  it('首帧已是组、测不到折前高度时不播', () => {
    const { measure } = measurer(0);
    const first = diffFoldMotion(EMPTY_FOLD_MOTION, foldTimeline(live, true, new Set()), measure);
    expect(
      diffFoldMotion(first.next, foldTimeline(paired, true, new Set()), measure).collapses
    ).toEqual([]);
    expect(
      diffFoldMotion(EMPTY_FOLD_MOTION, foldTimeline(paired, true, new Set([KEY])), measure).expands
    ).toEqual([]);
  });
});
