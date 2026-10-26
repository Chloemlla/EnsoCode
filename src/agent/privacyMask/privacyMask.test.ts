import { createHmac } from 'node:crypto';
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import {
  DEFAULT_PRIVACY_MASK_SETTINGS,
  type PrivacyMaskSettings,
} from '@shared/privacyMask/settings';
import { MaskReportBuilder, PrivacyVault } from '@shared/privacyMask/vault';
import { describe, expect, it, vi } from 'vitest';
import { maskContext, restoreStream, wrapStreamFn } from './index';

const KEY = 'sk-proj-AbCdEfGh1234567890IjKlMnOp';
const settings = (patch: Partial<PrivacyMaskSettings> = {}): PrivacyMaskSettings => ({
  ...DEFAULT_PRIVACY_MASK_SETTINGS,
  enabled: true,
  personal: { enabled: true, action: 'mask', kinds: ['email'] },
  ...patch,
});
const makeVault = (patch?: Partial<PrivacyMaskSettings>) => {
  const v = new PrivacyVault({
    digest: (d) => new Uint8Array(createHmac('sha256', 'k').update(d).digest()),
  });
  v.configure(settings(patch));
  return v;
};
const model = { id: 'm', api: 'anthropic-messages', provider: 'p' } as Model<Api>;
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const assistant = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant',
  api: model.api,
  provider: model.provider,
  model: model.id,
  content,
  usage,
  stopReason: 'stop',
  timestamp: 1,
});

describe('maskContext', () => {
  it('masks text, tool args and tool results without mutating the input', () => {
    const v = makeVault();
    const context: Context = {
      systemPrompt: `owner bob@corp.io`,
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } as never }],
      messages: [
        { role: 'user', content: `my key ${KEY}`, timestamp: 1 },
        assistant([
          { type: 'thinking', thinking: `saw ${KEY}`, thinkingSignature: 'sig' },
          { type: 'text', text: `ok ${KEY}` },
          { type: 'toolCall', id: 'c1', name: 'bash', arguments: { cmd: `curl -H ${KEY}`, n: 1 } },
        ]),
        {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'bash',
          isError: false,
          timestamp: 2,
          content: [
            { type: 'text', text: `{"email":"bob@corp.io"}` },
            { type: 'image', data: 'AAA', mimeType: 'image/png' },
          ],
        },
      ],
    };
    const snapshot = structuredClone(context);
    const report = new MaskReportBuilder();
    const out = maskContext(v, context, report);
    expect(context).toEqual(snapshot);
    const json = JSON.stringify(out);
    expect(json).not.toContain('bob@corp.io');
    // 带签名的 thinking 原样保留，避免签名失效
    expect((out.messages[1] as AssistantMessage).content[0]).toEqual(
      snapshot.messages[1].content[0]
    );
    const call = (out.messages[1] as AssistantMessage).content[2];
    expect(call).toMatchObject({ id: 'c1', name: 'bash', arguments: { n: 1 } });
    expect(JSON.stringify(call)).not.toContain(KEY);
    expect(out.messages[2]).toMatchObject({ toolCallId: 'c1', content: [{}, { data: 'AAA' }] });
    expect(
      report
        .build()
        .hits.map((h) => h.where)
        .sort()
    ).toEqual(['assistant', 'system', 'tool_args', 'tool_result', 'user'].sort());
  });

  it('masks unsigned thinking with known values only', () => {
    const v = makeVault();
    const report = new MaskReportBuilder();
    const out = maskContext(
      v,
      {
        messages: [
          { role: 'user', content: KEY, timestamp: 1 },
          assistant([{ type: 'thinking', thinking: `saw ${KEY} and joe@corp.io` }]),
        ],
      },
      report
    );
    const thinking = (out.messages[1] as AssistantMessage).content[0] as { thinking: string };
    expect(thinking.thinking).not.toContain(KEY);
    expect(thinking.thinking).toContain('joe@corp.io');
  });
});

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
  const events: AssistantMessageEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

/** 模拟 provider：复用同一个 partial 对象逐段推送 */
function fakeProvider(chunks: string[], args?: Record<string, string>) {
  const input = createAssistantMessageEventStream();
  const partial = assistant([]);
  queueMicrotask(() => {
    input.push({ type: 'start', partial });
    partial.content.push({ type: 'text', text: '' });
    input.push({ type: 'text_start', contentIndex: 0, partial });
    for (const c of chunks) {
      (partial.content[0] as { text: string }).text += c;
      input.push({ type: 'text_delta', contentIndex: 0, delta: c, partial });
    }
    const text = (partial.content[0] as { text: string }).text;
    input.push({ type: 'text_end', contentIndex: 0, content: text, partial });
    if (args) {
      const toolCall = { type: 'toolCall' as const, id: 't', name: 'write', arguments: args };
      partial.content.push(toolCall);
      input.push({ type: 'toolcall_end', contentIndex: 1, toolCall, partial });
    }
    input.push({ type: 'done', reason: args ? 'toolUse' : 'stop', message: partial });
    input.end();
  });
  return input;
}

describe('restoreStream', () => {
  it('restores placeholders split across deltas with append-only deltas', async () => {
    const v = makeVault();
    const masked = v.mask(`key ${KEY}`, 'user', new MaskReportBuilder());
    const placeholder = masked.slice(4);
    const chunks = [
      'use ',
      placeholder.slice(0, 5),
      placeholder.slice(5, 13),
      placeholder.slice(13),
      ' now',
    ];
    const report = new MaskReportBuilder();
    const onDone = vi.fn();
    const out = restoreStream(v, fakeProvider(chunks, { content: placeholder }), report, onDone);
    const events = await collect(out);
    const deltas = events.flatMap((e) => (e.type === 'text_delta' ? [e.delta] : []));
    expect(deltas.join('')).toBe(`use ${KEY} now`);
    expect(deltas.some((d) => d.includes('{{'))).toBe(false);
    for (const e of events)
      if ('partial' in e && e.partial.content[0]?.type === 'text')
        expect(e.partial.content[0].text).not.toContain('{{');
    const end = events.find((e) => e.type === 'text_end');
    expect(end).toMatchObject({ content: `use ${KEY} now` });
    expect(events.find((e) => e.type === 'toolcall_end')).toMatchObject({
      toolCall: { arguments: { content: KEY } },
    });
    const final = await out.result();
    expect(final.content).toMatchObject([
      { text: `use ${KEY} now` },
      { arguments: { content: KEY } },
    ]);
    expect(onDone).toHaveBeenCalledOnce();
    expect(report.build().restored).toBe(2);
  });

  it('restores shape fakes split across deltas', async () => {
    const v = makeVault({ secrets: { enabled: true, action: 'mask', shape: true } });
    const fake = v.mask(KEY, 'user', new MaskReportBuilder());
    const out = restoreStream(
      v,
      fakeProvider(['k=', fake.slice(0, 10), fake.slice(10), '\n']),
      new MaskReportBuilder(),
      () => {}
    );
    const events = await collect(out);
    const deltas = events.flatMap((e) => (e.type === 'text_delta' ? [e.delta] : []));
    expect(deltas.join('')).toBe(`k=${KEY}\n`);
    expect(deltas.some((d) => d.includes(fake.slice(0, 10)))).toBe(false);
  });
});

describe('wrapStreamFn', () => {
  const context: Context = { messages: [{ role: 'user', content: `k ${KEY}`, timestamp: 1 }] };

  it('sends masked context and reports', async () => {
    const v = makeVault();
    const inner = vi.fn((_m: Model<Api>, c: Context) => {
      expect(JSON.stringify(c)).not.toContain(KEY);
      return fakeProvider(['ok']);
    });
    const onReport = vi.fn();
    const wrapped = wrapStreamFn(() => v, inner, onReport);
    await wrapped(model, context, {}).result();
    expect(inner).toHaveBeenCalledOnce();
    expect(onReport.mock.calls[0][0]).toMatchObject({
      blocked: false,
      hits: [{ kind: 'API_KEY' }],
    });
  });

  it('passes through when inactive or for virtual models', async () => {
    const inner = vi.fn((_m: Model<Api>, _c: Context) => fakeProvider(['ok']));
    const off = new PrivacyVault({ digest: () => new Uint8Array(32) });
    await wrapStreamFn(() => off, inner, vi.fn())(model, context, {}).result();
    expect(inner.mock.calls[0][1]).toBe(context);
    const v = makeVault();
    const virtual = { ...model, api: 'pi-virtual' } as Model<Api>;
    await wrapStreamFn(() => v, inner, vi.fn())(virtual, context, {}).result();
    expect(inner.mock.calls[1][1]).toBe(context);
  });

  it('blocks without calling the provider, with a non-retryable error, then masks next time', async () => {
    const v = makeVault({ secrets: { enabled: true, action: 'block', shape: false } });
    const inner = vi.fn(() => fakeProvider(['ok']));
    const onReport = vi.fn();
    const wrapped = wrapStreamFn(() => v, inner, onReport);
    const result = await wrapped(model, context, {}).result();
    expect(inner).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('error');
    const { isRetryableAssistantError } = await import('@earendil-works/pi-ai');
    expect(isRetryableAssistantError(result)).toBe(false);
    expect(onReport.mock.calls[0][0]).toMatchObject({ blocked: true });
    await wrapped(model, context, {}).result();
    expect(inner).toHaveBeenCalledOnce();
  });

  it('only blocks values in content added since the last assistant reply', async () => {
    const v = makeVault({ personal: { enabled: true, action: 'block', kinds: ['email'] } });
    const inner = vi.fn((_m: Model<Api>, _c: Context) => fakeProvider(['ok']));
    const history: Context = {
      messages: [
        { role: 'user', content: 'old bob@corp.io', timestamp: 1 },
        assistant([{ type: 'text', text: 'noted' }]),
        { role: 'user', content: 'go on', timestamp: 2 },
      ],
    };
    const ok = await wrapStreamFn(() => v, inner, vi.fn())(model, history, {}).result();
    expect(ok.stopReason).toBe('stop');
    expect(JSON.stringify(inner.mock.calls[0][1])).not.toContain('bob@corp.io');
    const fresh: Context = {
      messages: [...history.messages, { role: 'user', content: 'new joe@corp.io', timestamp: 3 }],
    };
    const blocked = await wrapStreamFn(() => v, inner, vi.fn())(model, fresh, {}).result();
    expect(blocked.stopReason).toBe('error');
  });

  it('fails closed when masking throws', async () => {
    const v = makeVault();
    vi.spyOn(v, 'mask').mockImplementation(() => {
      throw new Error('boom 503');
    });
    const inner = vi.fn(() => fakeProvider(['ok']));
    const result = await wrapStreamFn(() => v, inner, vi.fn())(model, context, {}).result();
    expect(inner).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).not.toContain('503');
  });
});
