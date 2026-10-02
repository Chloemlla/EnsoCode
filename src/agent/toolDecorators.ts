import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { isNestedToolCallId } from './codemode';
import { type RunawayGuard, withRunawayGuard } from './runawayGuard';
import { withSourceReference } from './sourceReference';
import { type SystemReminderRegistry, withSystemReminders } from './systemReminder';
import { type ToolOutputBudget, withToolOutputBudget } from './toolOutputBudget';

/**
 * 模型可见结果的装饰（引用 / 输出外置 / runaway / system reminder）。
 * codemode 嵌套调用的结果只进脚本，跳过装饰：否则提醒被脚本吞掉、输出被外置成文件路径。
 */
export function decorateSessionTools(
  tools: ToolDefinition[],
  options: {
    reminders: SystemReminderRegistry;
    runaway: RunawayGuard;
    budget: ToolOutputBudget;
  }
): ToolDefinition[] {
  return tools.map((tool) => {
    const decorated = withSystemReminders(
      withRunawayGuard(
        withToolOutputBudget(withSourceReference(tool), options.budget),
        options.runaway
      ),
      options.reminders
    );
    return {
      ...decorated,
      execute: (toolCallId, params, signal, onUpdate, ctx) =>
        (isNestedToolCallId(toolCallId) ? tool : decorated).execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          ctx
        ),
    };
  });
}
