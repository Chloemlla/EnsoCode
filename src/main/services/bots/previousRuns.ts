import type { Delegation } from '../../../shared/types/bot';
import { escapeXml } from './delegationBatch';

export const PREVIOUS_RUNS_MAX = 4000;
const FIELD_MAX = 600;
const TRUNCATED = '…[truncated]';

const cut = (text: string) =>
  escapeXml(text.length > FIELD_MAX ? `${text.slice(0, FIELD_MAX)}${TRUNCATED}` : text);

/**
 * 子会话不能续用（被删、换了工作区）或改派给别人时，把任务的历次执行拼成上下文；不调模型。
 * 每段只取前 600 字，总长不超过 PREVIOUS_RUNS_MAX，放不下时丢最早的执行，截断处都标出。
 */
export function previousRunsText(
  runs: readonly Delegation[],
  options: { name: (botId: string) => string; returnReason?: string }
): string {
  if (!runs.length && !options.returnReason) return '';
  const blocks = runs.map((record, index) => {
    const failure =
      record.state === 'failed' && record.failure ? ` failure="${record.failure}"` : '';
    const outcome = record.result || record.error || record.failure || '';
    return [
      `<run n="${index + 1}" member="${escapeXml(options.name(record.targetBotId))}" trigger="${record.trigger ?? 'delegate'}" state="${record.state}"${failure}>`,
      `<request>${cut(record.task)}</request>`,
      ...(record.blocked ? [`<blocked-need>${cut(record.blocked.need)}</blocked-need>`] : []),
      ...(outcome ? [`<result>${cut(outcome)}</result>`] : []),
      '</run>',
    ].join('\n');
  });
  const tail = [
    ...(options.returnReason
      ? [`<return-reason>${cut(options.returnReason)}</return-reason>`]
      : []),
    '</previous-runs>',
  ];
  const omittedLine = (count: number) => `<omitted runs="${count}">older runs truncated</omitted>`;
  const size = (parts: readonly string[]) => parts.join('\n').length;
  let kept: string[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const next = [blocks[i], ...kept];
    const omitted = i > 0 ? [omittedLine(i)] : [];
    if (size(['<previous-runs>', ...omitted, ...next, ...tail]) > PREVIOUS_RUNS_MAX) break;
    kept = next;
  }
  const omitted = blocks.length - kept.length;
  return ['<previous-runs>', ...(omitted ? [omittedLine(omitted)] : []), ...kept, ...tail].join(
    '\n'
  );
}
