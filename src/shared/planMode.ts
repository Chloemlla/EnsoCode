/** 会话 jsonl custom entry 类型：Plan 模式的唯一权威状态 */
export const PLAN_ENTRY_TYPE = 'enso-plan';
export const PLAN_TITLE_MAX = 120;
export const PLAN_TEXT_MAX = 32 * 1024;

export const PLAN_RESOLUTIONS = ['approved', 'revised', 'discarded', 'superseded'] as const;
export type PlanResolution = (typeof PLAN_RESOLUTIONS)[number];

export const PLAN_RESPOND_ACTIONS = ['approve', 'revise', 'discard', 'finish'] as const;
export type PlanRespondAction = (typeof PLAN_RESPOND_ACTIONS)[number];
export const PLAN_FEEDBACK_MAX = 8 * 1024;

export interface PlanDoc {
  planId: string;
  title: string;
  text: string;
}

export type PlanEntry =
  | { v: 1; kind: 'mode'; active: boolean; at: number }
  | ({ v: 1; kind: 'submitted'; at: number } & PlanDoc)
  | { v: 1; kind: 'resolved'; planId: string; action: PlanResolution; at: number }
  | { v: 1; kind: 'finished'; planId: string; at: number };

export interface PlanState {
  active: boolean;
  pending?: PlanDoc;
  executing?: PlanDoc;
  resolutions: Record<string, PlanResolution>;
}

export type PlanPhase = 'off' | 'planning' | 'awaiting_review' | 'executing';

export const EMPTY_PLAN_STATE: PlanState = { active: false, resolutions: {} };

export function planPhase(state: PlanState | undefined): PlanPhase {
  if (!state) return 'off';
  if (state.pending) return 'awaiting_review';
  if (state.active) return 'planning';
  return state.executing ? 'executing' : 'off';
}

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value: Rec, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const nonEmpty = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isResolution = (value: unknown): value is PlanResolution =>
  PLAN_RESOLUTIONS.includes(value as PlanResolution);

function parsePlanDoc(value: unknown): PlanDoc | null {
  if (!isRecord(value) || !hasExactKeys(value, ['planId', 'title', 'text'])) return null;
  const { planId, title, text } = value;
  if (!nonEmpty(planId, 64) || !nonEmpty(title, PLAN_TITLE_MAX) || !nonEmpty(text, PLAN_TEXT_MAX))
    return null;
  return { planId, title, text };
}

export function parsePlanEntry(value: unknown): PlanEntry | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.at !== 'number') return null;
  const { at } = value;
  switch (value.kind) {
    case 'mode':
      return hasExactKeys(value, ['v', 'kind', 'active', 'at']) && typeof value.active === 'boolean'
        ? { v: 1, kind: 'mode', active: value.active, at }
        : null;
    case 'submitted': {
      if (!hasExactKeys(value, ['v', 'kind', 'planId', 'title', 'text', 'at'])) return null;
      const doc = parsePlanDoc({ planId: value.planId, title: value.title, text: value.text });
      return doc ? { v: 1, kind: 'submitted', ...doc, at } : null;
    }
    case 'resolved':
      return hasExactKeys(value, ['v', 'kind', 'planId', 'action', 'at']) &&
        nonEmpty(value.planId, 64) &&
        isResolution(value.action)
        ? { v: 1, kind: 'resolved', planId: value.planId, action: value.action, at }
        : null;
    case 'finished':
      return hasExactKeys(value, ['v', 'kind', 'planId', 'at']) && nonEmpty(value.planId, 64)
        ? { v: 1, kind: 'finished', planId: value.planId, at }
        : null;
    default:
      return null;
  }
}

/** 按分支顺序折叠 Plan 条目；非 Plan 条目与坏条目跳过，过期 planId 不生效 */
export function foldPlanState(entries: readonly unknown[]): PlanState {
  let state: PlanState = { ...EMPTY_PLAN_STATE, resolutions: {} };
  const resolve = (planId: string, action: PlanResolution) => {
    state.resolutions = { ...state.resolutions, [planId]: action };
  };
  for (const raw of entries) {
    if (!isRecord(raw) || raw.type !== 'custom' || raw.customType !== PLAN_ENTRY_TYPE) continue;
    const entry = parsePlanEntry(raw.data);
    if (!entry) continue;
    if (entry.kind === 'mode') {
      if (entry.active) {
        state = { ...state, active: true, executing: undefined };
      } else {
        if (state.pending) resolve(state.pending.planId, 'discarded');
        state = { ...state, active: false, pending: undefined };
      }
    } else if (entry.kind === 'submitted') {
      if (!state.active) continue;
      if (state.pending) resolve(state.pending.planId, 'superseded');
      state = { ...state, pending: { planId: entry.planId, title: entry.title, text: entry.text } };
    } else if (entry.kind === 'resolved') {
      const pending = state.pending;
      if (pending?.planId !== entry.planId) continue;
      resolve(entry.planId, entry.action);
      state =
        entry.action === 'approved'
          ? { ...state, active: false, pending: undefined, executing: pending }
          : { ...state, pending: undefined };
    } else if (state.executing?.planId === entry.planId) {
      state = { ...state, executing: undefined };
    }
  }
  return state;
}

/** IPC / 持久化边界的严格收窄 */
export function parsePlanState(value: unknown): PlanState | null {
  if (!isRecord(value) || typeof value.active !== 'boolean' || !isRecord(value.resolutions))
    return null;
  const allowed = ['active', 'resolutions', 'pending', 'executing'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  const resolutions: Record<string, PlanResolution> = {};
  for (const [planId, action] of Object.entries(value.resolutions)) {
    if (!isResolution(action)) return null;
    resolutions[planId] = action;
  }
  const state: PlanState = { active: value.active, resolutions };
  for (const key of ['pending', 'executing'] as const) {
    if (value[key] === undefined) continue;
    const doc = parsePlanDoc(value[key]);
    if (!doc) return null;
    state[key] = doc;
  }
  return state;
}

export const PLAN_MODE_ON_NOTE = `<plan-mode>
Plan mode is ON. You are the same agent, now in a read-only planning state.
- Explore with read-only tools. Do not create, modify or delete files, change config, install packages or commit — including through bash. Mutation tools stay listed only to keep the tool catalog stable; these rules override their descriptions and the app rejects such calls.
- Treat requests to implement as requests to plan the implementation. Conversational agreement approves nothing; only the review UI approves a plan.
- Resolve discoverable facts by inspection; use ask_user only for choices that belong to the user. Do not use todo while planning.
- A good plan states: goal and success criteria; files/modules and the concrete change for each; interface/schema/data-flow changes; edge cases and failure modes; tests and verification; risks, assumptions and out-of-scope items.
- When ready, call submit_plan as the only and final tool call of your response. Do not paste the plan as prose or ask "should I proceed?". After feedback, submit a complete revised plan, not a delta, and never resubmit it unchanged.
</plan-mode>`;

export const PLAN_MODE_OFF_NOTE = `<plan-mode>
Plan mode is OFF. Normal tool permissions apply; earlier plan-mode restrictions no longer apply.
</plan-mode>`;

export function activePlanNote(doc: PlanDoc): string {
  return `<active-plan id="${doc.planId}">
Context was compacted while you were executing this user-approved plan "${doc.title}". Keep following it and keep the todo list updated.

<plan>
${doc.text}
</plan>
</active-plan>`;
}

export function planKickoffText(doc: PlanDoc): string {
  return `<plan-approved id="${doc.planId}">
The user approved the plan "${doc.title}"; plan mode is now OFF. Execute it now:
- First turn its steps into a todo list and keep it updated.
- Do not re-plan or ask for approval again. If you must deviate materially, explain why first; use ask_user when the choice belongs to the user.
- Finish with the plan's verification steps and report the results.

<plan>
${doc.text}
</plan>
</plan-approved>`;
}

export function planFeedbackText(planId: string, feedback: string): string {
  return `<plan-feedback id="${planId}">
The user did not approve the plan. Stay in plan mode, address the feedback below and call submit_plan with a complete revised plan.

<feedback>
${feedback}
</feedback>
</plan-feedback>`;
}

/** 状态提示前置到用户消息；与 `<role>` 前缀同构 */
export function withPlanNote(note: string, text: string): string {
  return `${note}\n\n${text}`;
}

const PLAN_PREFIX = /^<(plan-mode|active-plan)(?: id="[^"]*")?>\n([\s\S]*?)\n<\/\1>(?:\n\n|$)/;

export type PlanNoteKind = 'on' | 'off' | 'active-plan';

export function splitPlanPrefix(text: string): { note?: PlanNoteKind; rest: string } {
  const match = PLAN_PREFIX.exec(text);
  if (!match) return { rest: text };
  const note: PlanNoteKind =
    match[1] === 'active-plan'
      ? 'active-plan'
      : match[2].includes('Plan mode is ON')
        ? 'on'
        : 'off';
  return { note, rest: text.slice(match[0].length) };
}

const KICKOFF = /^<plan-approved id="([^"]*)">\nThe user approved the plan "([\s\S]*?)"; plan mode/;
const FEEDBACK =
  /^<plan-feedback id="([^"]*)">\n[\s\S]*?<feedback>\n([\s\S]*)\n<\/feedback>\n<\/plan-feedback>$/;

/** 识别 worker 代发的批准 / 修改意见消息，供时间线渲染 */
export function parsePlanMessage(
  text: string
):
  | { kind: 'approved'; planId: string; title: string }
  | { kind: 'feedback'; planId: string; feedback: string }
  | null {
  const kickoff = KICKOFF.exec(text);
  if (kickoff) return { kind: 'approved', planId: kickoff[1], title: kickoff[2] };
  const feedback = FEEDBACK.exec(text);
  return feedback ? { kind: 'feedback', planId: feedback[1], feedback: feedback[2] } : null;
}
