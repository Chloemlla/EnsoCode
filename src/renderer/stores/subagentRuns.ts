import type { AgentRunProgress } from '@shared/types/agent';
import { create } from 'zustand';

interface SubagentRunsState {
  /** 会话 → 在跑子代理进度；推送与兜底轮询都整体替换，任一路径漏了另一路径能收敛 */
  byConversation: Record<string, AgentRunProgress[]>;
  replace: (conversationId: string, runs: AgentRunProgress[]) => void;
}

export const useSubagentRunsStore = create<SubagentRunsState>((set) => ({
  byConversation: {},
  replace: (conversationId, runs) =>
    set((state) => {
      const byConversation = { ...state.byConversation };
      if (runs.length > 0) byConversation[conversationId] = runs;
      else if (byConversation[conversationId]) delete byConversation[conversationId];
      else return state;
      return { byConversation };
    }),
}));
