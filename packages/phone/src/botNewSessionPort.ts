import type { HostToPhone, PhoneToHost } from '@enso/pair';

type Result = Extract<HostToPhone, { type: 'bot-new-session-result' }>;

/** Destructive requests are correlated, never queued or automatically replayed. */
export class BotNewSessionPort {
  private generation = 0;
  private active: Promise<Result | null> | null = null;
  private pending: { chatId: string; requestId: string; settle(result: Result): void } | null =
    null;

  constructor(private readonly send: (command: PhoneToHost) => unknown) {}

  start(chatId: string, confirm: () => boolean): Promise<Result | null> {
    if (this.active) return this.active;
    const generation = this.generation;
    const run = async () => {
      const result = await this.request(chatId);
      if (generation !== this.generation) return { ...result, ok: false, error: 'offline' };
      if (result.needsConfirmation !== true) return result;
      if (!confirm()) return null;
      return this.request(chatId, true);
    };
    const active = run().finally(() => {
      if (this.active === active) this.active = null;
    });
    this.active = active;
    return active;
  }

  receive(result: Result): void {
    if (result.requestId === this.pending?.requestId && result.chatId === this.pending.chatId)
      this.pending.settle(result);
  }

  reset(): void {
    this.generation++;
    const pending = this.pending;
    if (pending)
      pending.settle({
        type: 'bot-new-session-result',
        chatId: pending.chatId,
        requestId: pending.requestId,
        ok: false,
        error: 'offline',
      });
    this.active = null;
  }

  private request(chatId: string, confirmed = false): Promise<Result> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(
        () =>
          this.receive({
            type: 'bot-new-session-result',
            chatId,
            requestId,
            ok: false,
            error: 'timeout',
          }),
        60_000
      );
      this.pending = {
        chatId,
        requestId,
        settle: (result) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(result);
        },
      };
      try {
        this.send({
          type: 'bot-new-session',
          chatId,
          requestId,
          ...(confirmed ? { confirmed: true } : {}),
        });
      } catch {
        this.receive({
          type: 'bot-new-session-result',
          chatId,
          requestId,
          ok: false,
          error: 'offline',
        });
      }
    });
  }
}
