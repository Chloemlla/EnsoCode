import type { SessionIdentity } from '@shared/builtinAgents';
import type {
  AgentControlToolRequest,
  AgentControlToolResponse,
  AgentWorkerEvent,
} from '@shared/types/agent';

export class AgentControlInvoker {
  private readonly pending = new Map<
    string,
    {
      resolve(response: AgentControlToolResponse): void;
      reject(error: Error): void;
      signal?: AbortSignal;
      onAbort?: () => void;
      detach?: AbortSignal;
      onDetach?: () => void;
    }
  >();
  private seq = 0;

  get pendingCount(): number {
    return this.pending.size;
  }

  constructor(
    private readonly identity: SessionIdentity,
    private readonly emit: (event: AgentWorkerEvent) => void,
    private readonly randomUuid: () => string = crypto.randomUUID,
    private readonly nextSeq: () => number = () => ++this.seq
  ) {}

  /**
   * signal：本轮被中止，wait 立即失败返回。
   * detach：只结束附带的等待（插话 / 用户「不等了」），仍等 Main 的回执，模型拿到等待被打断的结果。
   */
  invoke(
    request: AgentControlToolRequest,
    signal?: AbortSignal,
    detach?: AbortSignal
  ): Promise<AgentControlToolResponse> {
    if (signal?.aborted) return Promise.reject(new Error('Agent control wait interrupted.'));
    const requestId = this.randomUuid();
    // spawn/send 可能已在 Main 建好 Agent/Run：abort 只让 Main 打断附带的等待，回执照常回来
    const keepReceipt = request.operation === 'spawn' || request.operation === 'send';
    return new Promise((resolve, reject) => {
      const cancel = (kind: 'abort' | 'detach') =>
        this.emit({
          type: 'agent-control-cancel',
          identity: this.identity,
          seq: this.nextSeq(),
          requestId,
          kind,
        });
      const onAbort = () => {
        const pending = keepReceipt ? this.pending.get(requestId) : this.take(requestId);
        if (!pending) return;
        cancel('abort');
        if (!keepReceipt) reject(new Error('Agent control wait interrupted.'));
      };
      const onDetach = () => {
        if (this.pending.has(requestId)) cancel('detach');
      };
      this.pending.set(requestId, {
        resolve,
        reject,
        ...(signal ? { signal, onAbort } : {}),
        ...(detach ? { detach, onDetach } : {}),
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      detach?.addEventListener('abort', onDetach, { once: true });
      this.emit({
        type: 'agent-control-invoke',
        identity: this.identity,
        seq: this.nextSeq(),
        requestId,
        request,
      });
      if (detach?.aborted) onDetach();
    });
  }

  resolve(requestId: string, response: AgentControlToolResponse): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    pending.resolve(response);
    return true;
  }

  close(reason: string): void {
    for (const requestId of [...this.pending.keys()]) {
      this.take(requestId)?.reject(new Error(reason));
    }
  }

  private take(requestId: string) {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    if (pending.detach && pending.onDetach) {
      pending.detach.removeEventListener('abort', pending.onDetach);
    }
    return pending;
  }
}
