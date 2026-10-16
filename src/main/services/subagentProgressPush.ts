import type { AgentRunProgress } from '@shared/types/agent';

interface Window {
  timer?: ReturnType<typeof setTimeout>;
  pending?: AgentRunProgress[];
}

/** 按 owner 分窗节流：首个更新立即发，窗口内只留最新、窗口尾随发一次；负载是全量快照可直接丢中间态 */
export class SubagentProgressPush {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly send: (ownerId: string, runs: AgentRunProgress[]) => void,
    private readonly intervalMs = 200
  ) {}

  update(ownerId: string, runs: AgentRunProgress[]): void {
    const window = this.windows.get(ownerId);
    if (window) {
      window.pending = runs;
      return;
    }
    this.send(ownerId, runs);
    this.open(ownerId);
  }

  dispose(): void {
    for (const window of this.windows.values()) clearTimeout(window.timer);
    this.windows.clear();
  }

  private open(ownerId: string): void {
    const window: Window = {};
    window.timer = setTimeout(() => {
      this.windows.delete(ownerId);
      if (window.pending) this.update(ownerId, window.pending);
    }, this.intervalMs);
    this.windows.set(ownerId, window);
  }
}
