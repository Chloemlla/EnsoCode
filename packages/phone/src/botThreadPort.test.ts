import type { PhoneToHost } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotThreadPort } from './botThreadPort';

describe('Bot thread requests', () => {
  const send = vi.fn<(command: PhoneToHost) => void>();
  let port: BotThreadPort;
  const last = () =>
    send.mock.calls.at(-1)![0] as Extract<
      PhoneToHost,
      { type: 'bot-thread-create' | 'bot-thread-select' }
    >;
  beforeEach(() => {
    vi.useFakeTimers();
    send.mockReset();
    port = new BotThreadPort(send);
  });
  afterEach(() => {
    port.reset();
    vi.useRealTimers();
  });

  it('correlates the result by request id and ignores stale results', async () => {
    const result = port.request({ type: 'bot-thread-select', chatId: 'chat', threadId: 't' });
    const { requestId } = last();
    expect(last()).toEqual({ type: 'bot-thread-select', chatId: 'chat', threadId: 't', requestId });
    const reply = { type: 'bot-thread-result' as const, chatId: 'chat', ok: true, threadId: 't' };
    port.receive({ ...reply, requestId: 'other' });
    port.receive({ ...reply, chatId: 'other', requestId });
    port.receive({ ...reply, requestId });
    expect(await result).toEqual({ ...reply, requestId });
  });

  it('allows one request at a time without sending the second', async () => {
    const first = port.request({ type: 'bot-thread-create', chatId: 'chat' });
    expect(await port.request({ type: 'bot-thread-create', chatId: 'chat' })).toMatchObject({
      ok: false,
      error: 'busy',
    });
    expect(send).toHaveBeenCalledTimes(1);
    port.receive({
      type: 'bot-thread-result',
      chatId: 'chat',
      requestId: last().requestId,
      ok: true,
    });
    expect(await first).toMatchObject({ ok: true });
    void port.request({ type: 'bot-thread-create', chatId: 'chat' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('settles as timeout, offline on reset, or offline when sending throws', async () => {
    const timed = port.request({ type: 'bot-thread-create', chatId: 'chat' });
    vi.advanceTimersByTime(15_000);
    expect(await timed).toMatchObject({ ok: false, error: 'timeout' });

    const reset = port.request({ type: 'bot-thread-create', chatId: 'chat' });
    port.reset();
    expect(await reset).toMatchObject({ ok: false, error: 'offline' });

    send.mockImplementationOnce(() => {
      throw new Error('closed');
    });
    expect(await port.request({ type: 'bot-thread-create', chatId: 'chat' })).toMatchObject({
      ok: false,
      error: 'offline',
    });
  });
});
