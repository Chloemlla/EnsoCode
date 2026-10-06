import type { HostToPhone, PhoneToHost } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotNewSessionPort } from './botNewSessionPort';

describe('Bot new-session requests', () => {
  const send = vi.fn<(command: PhoneToHost) => void>();
  let port: BotNewSessionPort;
  const last = () =>
    send.mock.calls.at(-1)![0] as Extract<PhoneToHost, { type: 'bot-new-session' }>;
  const respond = (patch: Partial<Extract<HostToPhone, { type: 'bot-new-session-result' }>> = {}) =>
    port.receive({
      type: 'bot-new-session-result',
      chatId: last().chatId,
      requestId: last().requestId,
      ok: true,
      ...patch,
    });
  beforeEach(() => {
    vi.useFakeTimers();
    send.mockClear();
    port = new BotNewSessionPort(send);
  });
  afterEach(() => {
    port.reset();
    vi.useRealTimers();
  });

  it('starts directly when the host does not require confirmation', async () => {
    const confirm = vi.fn(() => true);
    const result = port.start('direct', confirm);
    expect(last()).toMatchObject({ type: 'bot-new-session', chatId: 'direct' });
    expect(last().confirmed).not.toBe(true);
    respond();
    expect(await result).toMatchObject({ ok: true });
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'only sends confirmed after host challenge and user choice %s',
    async (accept) => {
      const confirm = vi.fn(() => accept);
      const result = port.start('group', confirm);
      const firstId = last().requestId;
      respond({ ok: false, needsConfirmation: true });
      await Promise.resolve();
      expect(confirm).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledTimes(accept ? 2 : 1);
      if (accept) {
        expect(last().confirmed).toBe(true);
        expect(last().requestId).not.toBe(firstId);
        respond();
        expect(await result).toMatchObject({ ok: true });
      } else expect(await result).toBeNull();
    }
  );

  it('ignores wrong-chat and stale responses and blocks double taps', async () => {
    const confirm = vi.fn(() => true);
    const result = port.start('group', confirm);
    const duplicate = port.start('group', confirm);
    expect(send).toHaveBeenCalledOnce();
    respond({ chatId: 'other', needsConfirmation: true, ok: false });
    respond({ requestId: 'stale', needsConfirmation: true, ok: false });
    await Promise.resolve();
    expect(confirm).not.toHaveBeenCalled();
    respond({ ok: false, error: 'read-only' });
    expect(await result).toMatchObject({ ok: false, error: 'read-only' });
    expect(await duplicate).toMatchObject({ ok: false, error: 'read-only' });
  });

  it('disconnect/device switch settles the request and suppresses a queued confirmation', async () => {
    const confirm = vi.fn(() => true);
    const result = port.start('group', confirm);
    respond({ ok: false, needsConfirmation: true });
    port.reset();
    expect(await result).toMatchObject({ ok: false, error: 'offline' });
    expect(confirm).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it('times out without replaying a destructive request', async () => {
    const result = port.start('group', () => true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ ok: false, error: 'timeout' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('settles a synchronous transport failure instead of leaving the UI pending', async () => {
    send.mockImplementationOnce(() => {
      throw new Error('socket failed');
    });
    expect(await port.start('group', () => true)).toMatchObject({ ok: false, error: 'offline' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
