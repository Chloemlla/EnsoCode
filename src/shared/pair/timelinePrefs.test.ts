import { describe, expect, it } from 'vitest';
import { normalizeTimelinePrefs } from './timelinePrefs';

describe('normalizeTimelinePrefs', () => {
  it('旧桌面缺省字段时按桌面默认值', () => {
    expect(normalizeTimelinePrefs({})).toEqual({
      expandLiveReasoning: true,
      autoCollapseTurns: false,
      collapseCompletedActivity: true,
      pinUnfinishedTodos: true,
    });
  });

  it('透传桌面显式设置', () => {
    expect(
      normalizeTimelinePrefs({
        expandLiveReasoning: false,
        autoCollapseTurns: true,
        collapseCompletedActivity: false,
        pinUnfinishedTodos: false,
      })
    ).toEqual({
      expandLiveReasoning: false,
      autoCollapseTurns: true,
      collapseCompletedActivity: false,
      pinUnfinishedTodos: false,
    });
  });

  it('非布尔脏值回落默认值', () => {
    expect(
      normalizeTimelinePrefs({
        expandLiveReasoning: 'no',
        autoCollapseTurns: 'yes',
        collapseCompletedActivity: 0,
        pinUnfinishedTodos: null,
      })
    ).toEqual({
      expandLiveReasoning: true,
      autoCollapseTurns: false,
      collapseCompletedActivity: true,
      pinUnfinishedTodos: true,
    });
  });
});
