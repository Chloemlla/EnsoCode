import { describe, expect, it } from 'vitest';
import type { Delegation } from '../../../shared/types/bot';
import { PREVIOUS_RUNS_MAX, previousRunsText } from './previousRuns';

const run = (n: number, over: Partial<Delegation> = {}): Delegation => ({
  id: `run-${n}`,
  parentConversationId: 'p',
  parentBotId: 'boss',
  targetBotId: 'hou',
  chatId: 'chat',
  task: `request ${n}`,
  context: '',
  childConversationId: 'c',
  state: 'completed',
  result: `result ${n}`,
  depth: 1,
  createdAt: n,
  taskId: 'task',
  ...over,
});
const name = (id: string) => ({ hou: '阿后', xiao: '小三' })[id] ?? id;

describe('previousRunsText', () => {
  it('没有历次执行也没有退回理由时为空', () => {
    expect(previousRunsText([], { name })).toBe('');
  });

  it('按先后列出每次执行的来源、执行人、请求与结果，带退回理由，转义 XML', () => {
    const text = previousRunsText(
      [
        run(1),
        run(2, {
          targetBotId: 'xiao',
          trigger: 'retry',
          state: 'failed',
          failure: 'timeout',
          result: undefined,
          error: undefined,
        }),
        run(3, { trigger: 'rework', task: 'Returned for rework: <missing tests>' }),
      ],
      { name, returnReason: '还差 & 文档' }
    );
    expect(text).toBe(
      [
        '<previous-runs>',
        '<run n="1" member="阿后" trigger="delegate" state="completed">',
        '<request>request 1</request>',
        '<result>result 1</result>',
        '</run>',
        '<run n="2" member="小三" trigger="retry" state="failed" failure="timeout">',
        '<request>request 2</request>',
        '<result>timeout</result>',
        '</run>',
        '<run n="3" member="阿后" trigger="rework" state="completed">',
        '<request>Returned for rework: &lt;missing tests&gt;</request>',
        '<result>result 3</result>',
        '</run>',
        '<return-reason>还差 &amp; 文档</return-reason>',
        '</previous-runs>',
      ].join('\n')
    );
  });

  it('单段超 600 字截断并标注；总长不超过上限，丢掉的旧执行标出数量，保留最近的', () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      run(i + 1, { task: '任'.repeat(900), result: '果'.repeat(900) })
    );
    const text = previousRunsText(runs, { name, returnReason: '因'.repeat(900) });
    expect(text.length).toBeLessThanOrEqual(PREVIOUS_RUNS_MAX);
    expect(text).toContain(`<request>${'任'.repeat(600)}…[truncated]</request>`);
    expect(text).toContain(`<return-reason>${'因'.repeat(600)}…[truncated]</return-reason>`);
    const kept = [...text.matchAll(/<run n="(\d+)"/g)].map((match) => Number(match[1]));
    expect(kept.at(-1)).toBe(12);
    expect(kept).toEqual(kept.map((_, i) => 13 - kept.length + i));
    expect(text).toContain(`<omitted runs="${12 - kept.length}">older runs truncated</omitted>`);
  });
});
