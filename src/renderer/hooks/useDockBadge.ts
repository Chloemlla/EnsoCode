import { useEffect } from 'react';
import { useSessionsStore } from '@/stores/sessions';
import { waitingConversationCount } from '@/stores/sessions/pinned';
import { selectSidebarConversations } from '@/stores/sessions/sidebarDirectory';

/** 主窗：等你处理的会话数上报 Dock 角标；挂载即报一次清残留，之后仅变化时报。设置窗不挂。 */
export function useDockBadge(): void {
  const count = useSessionsStore((state) =>
    Math.min(
      999,
      waitingConversationCount(state.order, selectSidebarConversations(state.conversations))
    )
  );
  useEffect(() => {
    window.electronAPI.app.setBadgeCount(count);
  }, [count]);
}
