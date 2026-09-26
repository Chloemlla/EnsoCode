import type { Transition } from 'framer-motion';
import { easeOutLayout, springStandard } from '@/lib/motion';

export function shouldSkipSidePanelWidthAnim(input: {
  resizing: boolean;
  conversationId?: string;
  previousConversationId?: string;
}): boolean {
  if (input.resizing) return true;
  return (
    input.previousConversationId !== undefined &&
    input.conversationId !== undefined &&
    input.previousConversationId !== input.conversationId
  );
}

/** width 不 clamp：收到 0 时欠阻尼 spring 冲成负值会被丢弃，停在末段再瞬间归零，故收起固定用 tween */
export function sidePanelWidthTransition(input: {
  skip: boolean;
  cover: boolean;
  targetW: number;
}): Transition {
  if (input.skip) return { duration: 0 };
  return input.cover || input.targetW === 0 ? easeOutLayout : springStandard;
}
