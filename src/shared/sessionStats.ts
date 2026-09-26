import type { ProjectedMessage, SessionUsageTotals } from '@shared/types/agent';

export interface SessionStats {
  /** 轮数 = user 消息数（每次 prompt 一轮） */
  turns: number;
  /** 步数 = assistant 消息数（一轮可含多步：文本↔工具交替） */
  steps: number;
  /** LLM 墙钟 = Σ(step 完成 − step 开始) */
  llmMs: number;
  /** 工具墙钟 = 同一轮内相邻 step 之间的间隙之和 */
  toolMs: number;
  /** 计费输入 = 未命中输入 + 缓存读 + 缓存写 */
  inputTokens: number;
  outputTokens: number;
  /** 缓存读占计费输入的百分比；无计费输入时为 null */
  cacheHitPercent: number | null;
  /** 首 token 平均延迟（ms）；无采样步时为 null */
  ttftAvgMs: number | null;
  /** 解码吞吐（tok/s）；按整段请求墙钟，与 OMP 同口径；无采样或无输出时为 null */
  tokensPerSecond: number | null;
}

function stepTtftMs(message: ProjectedMessage): number | undefined {
  if (typeof message.ttft === 'number' && message.ttft > 0) return message.ttft;
  const timing = message.timing;
  if (!timing || timing.firstTokenMs === undefined) return undefined;
  return Math.max(0, timing.firstTokenMs - timing.stepStartMs);
}

function stepGenMs(message: ProjectedMessage): number | undefined {
  if (typeof message.duration === 'number' && message.duration > 0) return message.duration;
  const timing = message.timing;
  if (!timing || timing.completedMs === undefined) return undefined;
  return Math.max(0, timing.completedMs - timing.stepStartMs);
}

/** 从消息投影累计会话统计。纯函数。 */
export function computeStats(messages: ProjectedMessage[]): SessionStats {
  let turns = 0;
  let steps = 0;
  let uncached = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let llmMs = 0;
  let toolMs = 0;
  let ttftMs = 0;
  let ttftSteps = 0;
  let decodeMs = 0;
  let decodeTokens = 0;
  // 工具间隙基准：上一 step 的完成时刻；遇到 user 消息重置（轮尾后的间隙是用户等待，不计）
  let prevStepEndMs: number | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      turns += 1;
      prevStepEndMs = null;
    }
    if (message.role !== 'assistant') continue;
    steps += 1;
    if (message.usage) {
      uncached += message.usage.input;
      output += message.usage.output;
      cacheRead += message.usage.cacheRead;
      cacheWrite += message.usage.cacheWrite;
    }
    const timing = message.timing;
    const genMs = stepGenMs(message);
    if (genMs !== undefined) llmMs += genMs;
    const ttft = stepTtftMs(message);
    if (ttft !== undefined) {
      ttftMs += ttft;
      ttftSteps += 1;
    }
    const out = message.usage?.output ?? 0;
    if (genMs !== undefined && genMs > 0 && out > 0) {
      decodeMs += genMs;
      decodeTokens += out;
    }
    if (timing) {
      if (prevStepEndMs !== null) {
        toolMs += Math.max(0, timing.stepStartMs - prevStepEndMs);
      }
      prevStepEndMs = timing.completedMs ?? null;
    }
  }

  const inputTokens = uncached + cacheRead + cacheWrite;
  return {
    turns,
    steps,
    llmMs,
    toolMs,
    inputTokens,
    outputTokens: output,
    cacheHitPercent: inputTokens === 0 ? null : Math.round((cacheRead / inputTokens) * 100),
    ttftAvgMs: ttftSteps > 0 ? ttftMs / ttftSteps : null,
    tokensPerSecond:
      decodeMs > 0 && decodeTokens > 0
        ? Math.round((decodeTokens / (decodeMs / 1000)) * 10) / 10
        : null,
  };
}

/** 状态栏 token/缓存/速度三段所需字段；null（无采样）不输出，便于跨进程传输 */
export function toUsageTotals(stats: SessionStats): SessionUsageTotals {
  return {
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    ...(stats.cacheHitPercent !== null ? { cacheHitPercent: stats.cacheHitPercent } : {}),
    ...(stats.ttftAvgMs !== null ? { ttftAvgMs: stats.ttftAvgMs } : {}),
    ...(stats.tokensPerSecond !== null ? { tokensPerSecond: stats.tokensPerSecond } : {}),
  };
}
