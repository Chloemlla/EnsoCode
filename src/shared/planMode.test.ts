import { describe, expect, it } from 'vitest';
import {
  EMPTY_PLAN_STATE,
  foldPlanState,
  PLAN_ENTRY_TYPE,
  PLAN_MODE_OFF_NOTE,
  PLAN_MODE_ON_NOTE,
  parsePlanEntry,
  parsePlanMessage,
  parsePlanState,
  planFeedbackText,
  planKickoffText,
  planPhase,
  splitPlanPrefix,
  withPlanNote,
} from './planMode';

const custom = (data: unknown) => ({ type: 'custom', customType: PLAN_ENTRY_TYPE, data });
const mode = (active: boolean) => custom({ v: 1, kind: 'mode', active, at: 1 });
const submitted = (planId: string, title = 'T', text = '# Plan') =>
  custom({ v: 1, kind: 'submitted', planId, title, text, at: 1 });
const resolved = (planId: string, action: string) =>
  custom({ v: 1, kind: 'resolved', planId, action, at: 1 });

describe('parsePlanEntry', () => {
  it('接受合法条目', () => {
    expect(parsePlanEntry({ v: 1, kind: 'mode', active: true, at: 1 })).toEqual({
      v: 1,
      kind: 'mode',
      active: true,
      at: 1,
    });
  });

  it.each([
    null,
    { v: 2, kind: 'mode', active: true, at: 1 },
    { v: 1, kind: 'mode', active: 'yes', at: 1 },
    { v: 1, kind: 'mode', active: true, at: 1, extra: 1 },
    { v: 1, kind: 'submitted', planId: 'p', title: '', text: 'x', at: 1 },
    { v: 1, kind: 'submitted', planId: 'p', title: 't', text: '   ', at: 1 },
    { v: 1, kind: 'resolved', planId: 'p', action: 'maybe', at: 1 },
    { v: 1, kind: 'finished', at: 1 },
    { v: 1, kind: 'unknown', at: 1 },
  ])('拒绝坏条目 %j', (value) => {
    expect(parsePlanEntry(value)).toBeNull();
  });
});

describe('foldPlanState', () => {
  it('空分支为关闭', () => {
    expect(foldPlanState([])).toEqual(EMPTY_PLAN_STATE);
    expect(planPhase(foldPlanState([]))).toBe('off');
  });

  it('进入 → 提交 → 批准 → 执行 → 结束', () => {
    const entries = [mode(true)];
    expect(planPhase(foldPlanState(entries))).toBe('planning');
    entries.push(submitted('p1', '重构', '# 步骤'));
    const pending = foldPlanState(entries);
    expect(planPhase(pending)).toBe('awaiting_review');
    expect(pending.pending).toEqual({ planId: 'p1', title: '重构', text: '# 步骤' });
    entries.push(resolved('p1', 'approved'));
    const executing = foldPlanState(entries);
    expect(planPhase(executing)).toBe('executing');
    expect(executing.active).toBe(false);
    expect(executing.executing?.planId).toBe('p1');
    expect(executing.resolutions).toEqual({ p1: 'approved' });
    entries.push(custom({ v: 1, kind: 'finished', planId: 'p1', at: 1 }));
    expect(planPhase(foldPlanState(entries))).toBe('off');
  });

  it('要求修改 / 放弃 / 被新消息取代后回到规划', () => {
    for (const action of ['revised', 'discarded', 'superseded']) {
      const state = foldPlanState([mode(true), submitted('p1'), resolved('p1', action)]);
      expect(planPhase(state)).toBe('planning');
      expect(state.resolutions.p1).toBe(action);
    }
  });

  it('待审期间退出 Plan 视为放弃', () => {
    const state = foldPlanState([mode(true), submitted('p1'), mode(false)]);
    expect(planPhase(state)).toBe('off');
    expect(state.resolutions.p1).toBe('discarded');
  });

  it('再次进入 Plan 结束上一次执行', () => {
    const state = foldPlanState([
      mode(true),
      submitted('p1'),
      resolved('p1', 'approved'),
      mode(true),
    ]);
    expect(planPhase(state)).toBe('planning');
    expect(state.executing).toBeUndefined();
  });

  it('忽略过期 planId、非 Plan 条目和坏条目', () => {
    const state = foldPlanState([
      { type: 'message', message: { role: 'user' } },
      custom({ v: 9 }),
      { type: 'custom', customType: 'other', data: { v: 1, kind: 'mode', active: true, at: 1 } },
      mode(true),
      submitted('p1'),
      resolved('stale', 'approved'),
    ]);
    expect(planPhase(state)).toBe('awaiting_review');
    expect(state.resolutions).toEqual({});
  });

  it('未进入 Plan 时的提交无效', () => {
    expect(planPhase(foldPlanState([submitted('p1')]))).toBe('off');
  });
});

describe('parsePlanState', () => {
  it('往返', () => {
    const state = foldPlanState([mode(true), submitted('p1'), resolved('p1', 'revised')]);
    expect(parsePlanState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it.each([
    null,
    { active: 1, resolutions: {} },
    { active: true },
    { active: true, resolutions: { p: 'nope' } },
    { active: true, resolutions: {}, pending: { planId: 'p', title: 't' } },
  ])('拒绝 %j', (value) => {
    expect(parsePlanState(value)).toBeNull();
  });
});

describe('注入文本', () => {
  it('前缀可拆回原文', () => {
    const text = withPlanNote(PLAN_MODE_ON_NOTE, '帮我重构登录');
    expect(splitPlanPrefix(text)).toEqual({ note: 'on', rest: '帮我重构登录' });
    expect(splitPlanPrefix(withPlanNote(PLAN_MODE_OFF_NOTE, 'go'))).toEqual({
      note: 'off',
      rest: 'go',
    });
    expect(splitPlanPrefix('普通消息')).toEqual({ rest: '普通消息' });
  });

  it('批准与修改意见带计划 id 和正文', () => {
    const kickoff = planKickoffText({ planId: 'p1', title: '重构', text: '1. 改 A' });
    expect(kickoff).toMatch(/^<plan-approved id="p1">/);
    expect(kickoff).toContain('1. 改 A');
    expect(planFeedbackText('p1', '别动 B')).toMatch(/^<plan-feedback id="p1">[\s\S]*别动 B/);
  });

  it('识别批准与修改意见消息', () => {
    expect(parsePlanMessage(planKickoffText({ planId: 'p1', title: '重构', text: 'x' }))).toEqual({
      kind: 'approved',
      planId: 'p1',
      title: '重构',
    });
    expect(parsePlanMessage(planFeedbackText('p1', '别动 B\n第二行'))).toEqual({
      kind: 'feedback',
      planId: 'p1',
      feedback: '别动 B\n第二行',
    });
    expect(parsePlanMessage('普通消息')).toBeNull();
  });
});
