import type { HostToPhone, PhoneToHost } from '@enso/pair';

type Result = Extract<HostToPhone, { type: 'bot-thread-result' }>;
type Command =
  | { type: 'bot-thread-create'; chatId: string }
  | { type: 'bot-thread-select'; chatId: string; threadId: string };

const TIMEOUT_MS = 15_000;

/** 话题新建 / 切换：一次一个请求，按 requestId 结算；不排队、不自动重放 */
export class BotThreadPort {
  private pending: { chatId: string; requestId: string; settle(result: Result): void } | null =
    null;

  constructor(private readonly send: (command: PhoneToHost) => unknown) {}

  request(command: Command): Promise<Result> {
    const requestId = crypto.randomUUID();
    const fail = (error: string): Result => ({
      type: 'bot-thread-result',
      chatId: command.chatId,
      requestId,
      ok: false,
      error,
    });
    if (this.pending) return Promise.resolve(fail('busy'));
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.receive(fail('timeout')), TIMEOUT_MS);
      this.pending = {
        chatId: command.chatId,
        requestId,
        settle: (result) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(result);
        },
      };
      try {
        this.send({ ...command, requestId });
      } catch {
        this.receive(fail('offline'));
      }
    });
  }

  receive(result: Result): void {
    if (result.requestId === this.pending?.requestId && result.chatId === this.pending.chatId)
      this.pending.settle(result);
  }

  reset(): void {
    const pending = this.pending;
    if (pending)
      pending.settle({
        type: 'bot-thread-result',
        chatId: pending.chatId,
        requestId: pending.requestId,
        ok: false,
        error: 'offline',
      });
  }
}
