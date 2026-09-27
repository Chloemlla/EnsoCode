import type { VoicePhase } from './useVoiceInput';

/** 按住不足这么久就松开，按“说话时间太短”处理（轻点、误触） */
export const MIN_HOLD_MS = 500;
/** 手指从按下处上滑超过这么多像素进入取消区 */
export const CANCEL_DISTANCE = 72;
export const WAVE_BARS = 28;

export type ReleaseAction = 'finish' | 'cancel' | 'too-short' | 'none';

export function releaseAction({
  phase,
  heldMs,
  cancelZone,
}: {
  phase: VoicePhase;
  heldMs: number;
  cancelZone: boolean;
}): ReleaseAction {
  // 到时长上限已自动收尾（或启动失败），松手不再干预
  if (phase !== 'recording' && phase !== 'starting') return 'none';
  if (cancelZone) return 'cancel';
  if (phase === 'starting' || heldMs < MIN_HOLD_MS) return 'too-short';
  return 'finish';
}

export function inCancelZone(startY: number, y: number): boolean {
  return startY - y >= CANCEL_DISTANCE;
}

/** 波形历史定长滚动，最新的在最右 */
export function pushLevel(levels: readonly number[], level: number): number[] {
  const next = [...levels, level].slice(-WAVE_BARS);
  return next.length < WAVE_BARS
    ? [...new Array<number>(WAVE_BARS - next.length).fill(0), ...next]
    : next;
}
