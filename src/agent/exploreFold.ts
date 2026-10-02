import type { InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent';

export interface LlmMessage {
  role: string;
  content?: unknown;
  toolCallId?: string;
  isError?: boolean;
}

export interface ExploreFoldState {
  mark(goal: string): void;
  fold(report: string): string;
  apply(messages: LlmMessage[]): LlmMessage[];
  pending: boolean;
}

export function createExploreFoldState(): ExploreFoldState {
  let pendingGoal: string | undefined;

  return {
    get pending() {
      return pendingGoal !== undefined;
    },
    mark(goal: string) {
      if (pendingGoal !== undefined)
        throw new Error('explore_mark already active — call explore_fold first');
      const trimmed = goal.trim();
      if (!trimmed) throw new Error('goal is required');
      pendingGoal = trimmed;
    },
    fold(report: string) {
      if (pendingGoal === undefined) throw new Error('no active explore_mark');
      const trimmed = report.trim();
      if (!trimmed) throw new Error('report is required');
      pendingGoal = undefined;
      return trimmed;
    },
    apply: foldExploreContext,
  };
}

function toolCallsOf(message: LlmMessage): Array<{ id: string; name: string }> {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return message.content.filter(
    (part): part is { type: 'toolCall'; id: string; name: string } =>
      part?.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string'
  );
}

/**
 * 删除成功执行的 mark→fold 之间的工具轮次。mark/fold 调用及其结果保留：
 * 模型据此知道探索已完成，fold 结果正文即报告；工具调用与结果始终成对。
 */
export function foldExploreContext(messages: LlmMessage[]): LlmMessage[] {
  const drop = foldedIndices(messages);
  return drop.size === 0 ? messages : messages.filter((_, i) => !drop.has(i));
}

function foldedIndices(messages: LlmMessage[]): Set<number> {
  const failed = new Set<string>();
  const done = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'toolResult' || !message.toolCallId) continue;
    (message.isError === true ? failed : done).add(message.toolCallId);
  }
  const ok = (id: string) => done.has(id) && !failed.has(id);
  const drop = new Set<number>();
  let from: number | undefined;
  for (let i = 0; i < messages.length; i++) {
    const role = messages[i].role;
    if (role !== 'assistant' && role !== 'toolResult' && role !== 'system') {
      from = undefined;
      continue;
    }
    const calls = toolCallsOf(messages[i]);
    const folds = calls.some((c) => c.name === 'explore_fold' && ok(c.id));
    if (from !== undefined && folds) {
      for (let j = from; j < i; j++) if (messages[j].role !== 'system') drop.add(j);
      from = undefined;
    } else if (
      from === undefined &&
      !folds &&
      calls.some((c) => c.name === 'explore_mark' && ok(c.id))
    ) {
      from = i + 1;
      while (messages[from]?.role === 'toolResult') from++;
      i = from - 1;
    }
  }
  return drop;
}

interface ProjectedEntry {
  sourceEntry: { id: string; type: string };
  messages: LlmMessage[];
}

/** 投影里整条落在折叠区间内的 message 条目 id，供写成持久 context_edit */
export function exploreFoldContextEdits(entries: readonly ProjectedEntry[]): string[] {
  const owners = entries.flatMap((entry) => entry.messages.map(() => entry));
  const drop = foldedIndices(entries.flatMap((entry) => entry.messages));
  if (drop.size === 0) return [];
  const kept = new Set(owners.filter((_, i) => !drop.has(i)));
  return [...new Set(owners.filter((_, i) => drop.has(i)))]
    .filter((entry) => entry.sourceEntry.type === 'message' && !kept.has(entry))
    .map((entry) => entry.sourceEntry.id);
}

function foldedThisTurn(message: LlmMessage, toolResults: readonly LlmMessage[]): boolean {
  return toolCallsOf(message).some(
    (c) =>
      c.name === 'explore_fold' &&
      toolResults.some((r) => r.toolCallId === c.id && r.isError !== true)
  );
}

/**
 * fold 成功的轮次结束时把折叠区间写成 context_edit，pi 的投影、压缩与用量估算都看到折叠后的上下文；
 * context 钩子兜底没有持久编辑的旧会话。
 */
export function exploreFoldExtension(state: ExploreFoldState): InlineExtension {
  return {
    name: 'explore-fold',
    hidden: true,
    factory: (pi) => {
      pi.on('context', (event) => ({
        messages: state.apply(event.messages as never) as typeof event.messages,
      }));
      pi.on('turn_end', (event) => {
        if (
          !foldedThisTurn(
            event.message as unknown as LlmMessage,
            event.toolResults as unknown as LlmMessage[]
          )
        )
          return;
        const targets = exploreFoldContextEdits(
          event.context.contextEntries as unknown as ProjectedEntry[]
        );
        if (targets.length === 0) return;
        return {
          entries: [
            ...event.entries,
            ...targets.map((targetId) => ({
              type: 'context_edit' as const,
              targetId,
              replacement: null,
            })),
          ],
        };
      });
    },
  };
}

export function createExploreFoldTools(state: ExploreFoldState): ToolDefinition[] {
  return [
    {
      name: 'explore_mark',
      label: 'Explore mark',
      description:
        'Start an explore-fold: mark before a burst of read/grep/find. MUST call explore_fold with a concise report before finishing.',
      promptSnippet:
        'explore_mark / explore_fold: mark before exploratory reads, then fold so only the report stays in later LLM context.',
      parameters: {
        type: 'object',
        properties: { goal: { type: 'string', description: 'What you are investigating' } },
        required: ['goal'],
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, params) {
        const goal = String((params as { goal?: string }).goal ?? '');
        state.mark(goal);
        return {
          content: [{ type: 'text' as const, text: `Explore marked: ${goal.trim()}` }],
          details: undefined,
        };
      },
    },
    {
      name: 'explore_fold',
      label: 'Explore fold',
      description:
        'End the active explore-fold. Intermediate tool rounds are removed from later LLM context and replaced by this report. Timeline stays intact.',
      parameters: {
        type: 'object',
        properties: { report: { type: 'string', description: 'Concise findings to keep' } },
        required: ['report'],
      } as unknown as ToolDefinition['parameters'],
      async execute(_id, params) {
        const report = String((params as { report?: string }).report ?? '');
        state.fold(report);
        // 正文带上 report：这段结果已被折叠跨度替换，不进后续 LLM 上下文，
        // 但时间线展开后能直接看到存下来的是什么。
        return {
          content: [
            {
              type: 'text' as const,
              text: `Explore folded. Subsequent turns see only this report.\n\n${report.trim()}`,
            },
          ],
          details: { report: report.trim() },
        };
      },
    },
  ];
}
