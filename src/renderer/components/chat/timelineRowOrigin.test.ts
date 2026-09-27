import { describe, expect, it } from 'vitest';
import { foldTimeline, type TimelineItem } from '@/stores/sessions/timeline';
import { nextTimelineRowOrigin, TIMELINE_ROW_INDEX_BASE } from './timelineRowOrigin';

function readTool(key: string): TimelineItem {
  return {
    kind: 'tool',
    key,
    name: 'read',
    summary: key,
    output: null,
    state: 'ok',
    edits: null,
    writeContent: null,
    todos: null,
    durationMs: null,
    agentMeta: null,
  };
}

describe('nextTimelineRowOrigin', () => {
  it('前置几行就把原点减几，不看消息下标', () => {
    const first = nextTimelineRowOrigin(null, ['m40', 'm41']);
    expect(first.firstItemIndex).toBe(TIMELINE_ROW_INDEX_BASE);
    const prepended = nextTimelineRowOrigin(first.anchor, ['m10', 'm11', 'm40', 'm41']);
    expect(prepended.remount).toBe(false);
    expect(prepended.firstItemIndex).toBe(TIMELINE_ROW_INDEX_BASE - 2);
    expect(prepended.anchor).toEqual({
      keys: ['m10', 'm11', 'm40', 'm41'],
      index: TIMELINE_ROW_INDEX_BASE - 2,
    });
  });

  it('旧首行消失时重挂并回到原点', () => {
    const first = nextTimelineRowOrigin(null, ['tail']);
    const replaced = nextTimelineRowOrigin(first.anchor, ['full-0', 'full-1']);
    expect(replaced.remount).toBe(true);
    expect(replaced.firstItemIndex).toBe(TIMELINE_ROW_INDEX_BASE);
  });

  it('尾部追加不改变原点', () => {
    const first = nextTimelineRowOrigin(null, ['m0']);
    const appended = nextTimelineRowOrigin(first.anchor, ['m0', 'm1']);
    expect(appended).toMatchObject({
      firstItemIndex: TIMELINE_ROW_INDEX_BASE,
      remount: false,
    });
  });

  it('前置把原来的首行收进工具组时，按折叠行重挂，而不是按原始行往前移', () => {
    const tail = [readTool('a'), readTool('b')];
    const full = [readTool('older'), ...tail];
    const tailFolded = foldTimeline(tail, false, new Set(), { compact: true });
    const fullFolded = foldTimeline(full, false, new Set(), { compact: true });
    expect(tailFolded.map((item) => item.key)).toEqual(['a', 'b']);
    expect(fullFolded.map((item) => item.key)).toEqual(['group-older']);
    const origin = nextTimelineRowOrigin(
      null,
      tailFolded.map((item) => item.key)
    );
    const next = nextTimelineRowOrigin(
      origin.anchor,
      fullFolded.map((item) => item.key)
    );
    expect(next.remount).toBe(true);
    expect(next.firstItemIndex).toBe(TIMELINE_ROW_INDEX_BASE);
  });

  it('前置的新页并进首行过程组时按第一条仍在的旧行对齐，不重挂（重挂会跳回底部）', () => {
    const origin = nextTimelineRowOrigin(null, ['group-668-0', '672-0', 'group-672-1']);
    const next = nextTimelineRowOrigin(origin.anchor, [
      '650-0',
      'group-650-1',
      '672-0',
      'group-672-1',
    ]);
    expect(next.remount).toBe(false);
    expect(next.firstItemIndex).toBe(TIMELINE_ROW_INDEX_BASE - 1);
  });

  it('新页整段并进首行（行数不变）时原点不动', () => {
    const origin = nextTimelineRowOrigin(null, ['group-80-0', '128-0']);
    const next = nextTimelineRowOrigin(origin.anchor, ['group-21-0', '128-0']);
    expect(next).toMatchObject({ firstItemIndex: TIMELINE_ROW_INDEX_BASE, remount: false });
  });
});
