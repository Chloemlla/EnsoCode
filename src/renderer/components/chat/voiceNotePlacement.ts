const GAP = 6;
const EDGE = 8;
const MAX_WIDTH = 448;

/** 语音气泡贴在按钮上方、左缘对齐，窄窗口里不越出视口 */
export function voiceNotePlacement(
  anchor: { left: number; top: number },
  viewport: { width: number; height: number }
): { left: number; bottom: number; maxWidth: number } {
  const maxWidth = Math.min(MAX_WIDTH, viewport.width * 0.8);
  return {
    left: Math.max(EDGE, Math.min(anchor.left, viewport.width - EDGE - maxWidth)),
    bottom: viewport.height - anchor.top + GAP,
    maxWidth,
  };
}
