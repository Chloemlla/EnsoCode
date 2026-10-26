import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Message,
  type Model,
  type Tool,
} from '@earendil-works/pi-ai';
import { type MaskReport, MaskReportBuilder, type MaskWhere } from '@shared/privacyMask/report';
import type { PrivacyVault } from '@shared/privacyMask/vault';

type Text = { type: 'text'; text: string };

export function maskDeep(
  v: PrivacyVault,
  value: unknown,
  report: MaskReportBuilder,
  where: MaskWhere = 'tool_args',
  allowBlock = true
): unknown {
  if (typeof value === 'string') return v.mask(value, where, report, allowBlock);
  if (Array.isArray(value)) return value.map((x) => maskDeep(v, x, report, where, allowBlock));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, x]) => [k, maskDeep(v, x, report, where, allowBlock)])
    );
  return value;
}

function restoreDeep(v: PrivacyVault, value: unknown, report?: MaskReportBuilder): unknown {
  if (typeof value === 'string') return v.restore(value, report);
  if (Array.isArray(value)) return value.map((x) => restoreDeep(v, x, report));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, x]) => [k, restoreDeep(v, x, report)])
    );
  return value;
}

const maskTexts = <T extends { type: string }>(
  v: PrivacyVault,
  parts: T[],
  where: MaskWhere,
  report: MaskReportBuilder,
  allowBlock: boolean
): T[] =>
  parts.map((p) =>
    p.type === 'text'
      ? { ...p, text: v.mask((p as unknown as Text).text, where, report, allowBlock) }
      : p
  );

const maskTools = (v: PrivacyVault, tools: Tool[], report: MaskReportBuilder): Tool[] =>
  tools.map((t) => ({ ...t, description: v.mask(t.description, 'tools', report, false) }));

function maskMessage(
  v: PrivacyVault,
  m: Message,
  report: MaskReportBuilder,
  fresh: boolean
): Message {
  switch (m.role) {
    case 'system':
      return {
        ...m,
        content:
          typeof m.content === 'string'
            ? v.mask(m.content, 'system', report, false)
            : maskTexts(v, m.content, 'system', report, false),
        ...(m.sections && {
          sections: Object.fromEntries(
            Object.entries(m.sections).map(([k, s]) => [
              k,
              typeof s === 'string' ? v.mask(s, 'system', report, false) : s,
            ])
          ),
        }),
        ...(m.toolsAdded && { toolsAdded: maskTools(v, m.toolsAdded, report) }),
      };
    case 'user':
      return {
        ...m,
        content:
          typeof m.content === 'string'
            ? v.mask(m.content, 'user', report, fresh)
            : maskTexts(v, m.content, 'user', report, fresh),
      };
    case 'toolResult':
      return { ...m, content: maskTexts(v, m.content, 'tool_result', report, fresh) };
    case 'assistant':
      return {
        ...m,
        content: m.content.map((b) => {
          if (b.type === 'text') return { ...b, text: v.mask(b.text, 'assistant', report, false) };
          if (b.type === 'toolCall')
            return {
              ...b,
              arguments: maskDeep(v, b.arguments, report, 'tool_args', false) as typeof b.arguments,
            };
          // 签名 / 加密的 thinking 按厂商原文回传，改一个字都会失效
          if (b.redacted || b.thinkingSignature) return b;
          return { ...b, thinking: v.maskKnown(b.thinking) };
        }),
      };
    default:
      return m;
  }
}

/** 返回新对象，绝不改写会话持有的 Context */
export function maskContext(v: PrivacyVault, context: Context, report: MaskReportBuilder): Context {
  // 拦截只针对上次回复之后新进入上下文的内容（新用户消息、新工具输出）
  let lastAssistant = -1;
  context.messages.forEach((m, i) => {
    if (m.role === 'assistant') lastAssistant = i;
  });
  return {
    ...context,
    ...(context.systemPrompt !== undefined && {
      systemPrompt: v.mask(context.systemPrompt, 'system', report, false),
    }),
    ...(context.tools && { tools: maskTools(v, context.tools, report) }),
    messages: context.messages.map((m, i) => maskMessage(v, m, report, i > lastAssistant)),
  };
}

function shownText(v: PrivacyVault, raw: string): string {
  return v.restore(raw.slice(0, raw.length - v.holdLength(raw)));
}

function restoreMessage(
  v: PrivacyVault,
  m: AssistantMessage,
  final: boolean,
  report?: MaskReportBuilder
): AssistantMessage {
  return {
    ...m,
    content: m.content.map((b) => {
      if (b.type === 'text')
        return { ...b, text: final ? v.restore(b.text, report) : shownText(v, b.text) };
      if (b.type === 'toolCall')
        return {
          ...b,
          arguments: restoreDeep(v, b.arguments, final ? report : undefined) as typeof b.arguments,
        };
      // thinking 保留占位符：下一轮原样回传才能通过签名校验
      return b;
    }),
  };
}

function errorMessage(model: Model<Api>, text: string): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [],
    timestamp: Date.now(),
    stopReason: 'error',
    errorMessage: text,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function errorStream(model: Model<Api>, text: string): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();
  const message = errorMessage(model, text);
  out.push({ type: 'error', reason: 'error', error: message });
  out.end(message);
  return out;
}

export function restoreStream(
  v: PrivacyVault,
  input: AssistantMessageEventStream,
  report: MaskReportBuilder,
  onFinish: () => void
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();
  const emitted = new Map<number, string>();
  let final: AssistantMessage | undefined;
  const finish = (message: AssistantMessage) => {
    if (!final) {
      final = restoreMessage(v, message, true, report);
      onFinish();
    }
    return final;
  };
  void (async () => {
    try {
      for await (const event of input) {
        switch (event.type) {
          case 'text_delta': {
            const block = event.partial.content[event.contentIndex];
            const shown = block?.type === 'text' ? shownText(v, block.text) : event.delta;
            const prev = emitted.get(event.contentIndex) ?? '';
            if (!shown.startsWith(prev) || shown.length === prev.length) break;
            emitted.set(event.contentIndex, shown);
            out.push({
              ...event,
              delta: shown.slice(prev.length),
              partial: restoreMessage(v, event.partial, false),
            });
            break;
          }
          case 'text_end': {
            const content = v.restore(event.content);
            const prev = emitted.get(event.contentIndex) ?? '';
            const partial = restoreMessage(v, event.partial, false);
            const block = partial.content[event.contentIndex];
            if (block?.type === 'text') block.text = content;
            // 冲刷扣留的尾巴，保证 delta 拼接与最终正文一致
            if (content.startsWith(prev) && content.length > prev.length)
              out.push({
                type: 'text_delta',
                contentIndex: event.contentIndex,
                delta: content.slice(prev.length),
                partial,
              });
            emitted.set(event.contentIndex, content);
            out.push({ ...event, content, partial });
            break;
          }
          case 'toolcall_end':
            out.push({
              ...event,
              toolCall: {
                ...event.toolCall,
                arguments: restoreDeep(
                  v,
                  event.toolCall.arguments
                ) as typeof event.toolCall.arguments,
              },
              partial: restoreMessage(v, event.partial, false),
            });
            break;
          case 'done':
            out.push({ ...event, message: finish(event.message) });
            break;
          case 'error':
            out.push({ ...event, error: finish(event.error) });
            break;
          default:
            out.push({ ...event, partial: restoreMessage(v, event.partial, false) });
        }
      }
      out.end(final ?? finish(await input.result()));
    } catch {
      const message = errorMessage(
        { api: 'unknown', provider: 'unknown', id: 'unknown' } as unknown as Model<Api>,
        'Privacy masking could not restore the model response.'
      );
      out.push({ type: 'error', reason: 'error', error: message });
      out.end(message);
    }
  })();
  return out;
}

function blockedText(report: MaskReport): string {
  const items = [
    ...new Set(
      report.hits.filter((h) => h.action === 'block').map((h) => `${h.kind} in ${h.where}`)
    ),
  ];
  // 文案避开 pi 可重试错误关键词，不带 preview 长度数字
  return (
    `Privacy masking blocked this request (${items.join(', ')}). Nothing was sent to the model. ` +
    'Send again to continue with these values masked, or add them to the allow list.'
  );
}

export const isVirtualModel = (model: Model<Api>) => model.api === 'pi-virtual';

type StreamLike<O> = (
  model: Model<Api>,
  context: Context,
  options?: O
) => AssistantMessageEventStream;

/** 出站脱敏 + 入站还原；任何脱敏异常都 fail closed，不做明文回退 */
export function wrapStreamFn<O>(
  getVault: () => PrivacyVault,
  inner: StreamLike<O>,
  onReport: (report: MaskReport, model: Model<Api>) => void
): StreamLike<O> {
  return (model, context, options) => {
    const v = getVault();
    // 虚拟模型由 runtime 递归到真实模型时再处理，避免两遍脱敏
    if (!v.active || isVirtualModel(model)) return inner(model, context, options);
    const report = new MaskReportBuilder();
    let masked: Context;
    try {
      masked = maskContext(v, context, report);
    } catch {
      return errorStream(model, 'Privacy masking failed, so the request was not sent.');
    }
    const emit = () => {
      if (report.empty) return;
      try {
        onReport(report.build(), model);
      } catch {
        // 记录失败不影响请求
      }
    };
    if (report.blocked) {
      const built = report.build();
      emit();
      return errorStream(model, blockedText(built));
    }
    return restoreStream(v, inner(model, masked, options), report, emit);
  };
}
