import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftBroker } from './draftBroker';

const sink = (id: number) => ({
  id,
  sent: [] as unknown[],
  destroyed: false,
  send(_channel: string, ...args: unknown[]) {
    this.sent.push(args[0]);
  },
  isDestroyed() {
    return this.destroyed;
  },
});

let window1: ReturnType<typeof sink>;
let broker: DraftBroker;

beforeEach(() => {
  vi.useFakeTimers();
  window1 = sink(1);
  broker = new DraftBroker({
    channel: 'draft',
    find: (id) => (id === 1 ? window1 : null),
    timeoutMs: 1000,
  });
});
afterEach(() => vi.useRealTimers());

const lastRequestId = () => (window1.sent.at(-1) as { requestId: string }).requestId;

describe('DraftBroker', () => {
  it('请求发到发起窗口，同一窗口的回包兑现结果', async () => {
    const pending = broker.request(1, 's1', 'readDraft', {});
    expect(window1.sent[0]).toMatchObject({ sessionId: 's1', op: 'readDraft', payload: {} });
    broker.respond(1, { requestId: lastRequestId(), ok: true, value: { text: 'a' } });
    await expect(pending).resolves.toEqual({ text: 'a' });
  });

  it('别的窗口冒充回包被忽略', async () => {
    const pending = broker.request(1, 's1', 'readDraft', {});
    broker.respond(2, { requestId: lastRequestId(), ok: true, value: 'forged' });
    vi.advanceTimersByTime(1000);
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('渲染进程报错时带回错误码', async () => {
    const pending = broker.request(1, 's1', 'replaceDraft', { text: 'x' });
    broker.respond(1, {
      requestId: lastRequestId(),
      ok: false,
      code: 'DRAFT_CHANGED',
      error: 'changed',
    });
    await expect(pending).rejects.toMatchObject({ code: 'DRAFT_CHANGED', message: 'changed' });
  });

  it('没有发起窗口或窗口已关闭时直接拒绝', async () => {
    await expect(broker.request(null, 's1', 'readDraft', {})).rejects.toMatchObject({
      code: 'NO_COMPOSER',
    });
    window1.destroyed = true;
    await expect(broker.request(1, 's1', 'readDraft', {})).rejects.toMatchObject({
      code: 'NO_COMPOSER',
    });
  });

  it('超时后迟到的回包不再生效', async () => {
    const pending = broker.request(1, 's1', 'readDraft', {});
    const id = lastRequestId();
    vi.advanceTimersByTime(1000);
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(() => broker.respond(1, { requestId: id, ok: true, value: 1 })).not.toThrow();
  });
});
