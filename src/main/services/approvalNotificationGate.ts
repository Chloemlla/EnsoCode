import type { RendererAgentEvent } from '@shared/types/agent';

interface SessionApprovals {
  generation: string;
  seq: number;
  pending: Map<string, object>;
}

/** 只为首次进入人工阶段的审批发通知；异步通知在发出前还须核对请求未结束。 */
export class ApprovalNotificationGate {
  private sessions = new Map<string, SessionApprovals>();

  observe(event: RendererAgentEvent): (() => boolean) | undefined {
    if (event.type === 'worker-exited') this.sessions.clear();
    if (event.type === 'parent-ended' || event.type === 'child-ended')
      this.sessions.delete(event.identity.sessionId);
    if (event.type !== 'approval-request' && event.type !== 'approval-resolved') return () => true;

    const { sessionId, generation } = event.identity;
    let session = this.sessions.get(sessionId);
    if (!session || session.generation !== generation) {
      session = { generation, seq: -1, pending: new Map() };
      this.sessions.set(sessionId, session);
    }
    if (event.seq <= session.seq) return undefined;
    session.seq = event.seq;
    if (event.type === 'approval-resolved') {
      session.pending.delete(event.requestId);
      return undefined;
    }
    const { requestId, phase } = event.request;
    if (phase === 'reviewing') return undefined;
    if (session.pending.has(requestId)) return undefined;
    const token = {};
    session.pending.set(requestId, token);
    return () =>
      this.sessions.get(sessionId) === session && session.pending.get(requestId) === token;
  }
}
