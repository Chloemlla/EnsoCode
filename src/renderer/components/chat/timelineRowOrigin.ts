/** 不知道全文行数时用一个足够大的原点，前置只按实际新增行数下移。 */
export const TIMELINE_ROW_INDEX_BASE = 1_000_000;

export interface TimelineRowAnchor {
  keys: readonly string[];
  index: number;
}

/**
 * Virtuoso 的 firstItemIndex 差值必须等于前置的行数，不能用消息绝对下标。
 * 新页常把旧首行并进过程组（组 key 随首个子行变），按第一条仍在的旧行对齐；
 * 旧行全都不在（尾窗被全量换掉）才重挂，让列表重新贴底。
 */
export function nextTimelineRowOrigin(
  previous: TimelineRowAnchor | null,
  keys: readonly string[],
  base = TIMELINE_ROW_INDEX_BASE
): { anchor: TimelineRowAnchor | null; firstItemIndex: number; remount: boolean } {
  if (keys.length === 0) return { anchor: null, firstItemIndex: base, remount: false };
  if (!previous) {
    return { anchor: { keys, index: base }, firstItemIndex: base, remount: false };
  }
  const positions = new Map(keys.map((key, index) => [key, index]));
  for (let i = 0; i < previous.keys.length; i++) {
    const at = positions.get(previous.keys[i]);
    if (at === undefined) continue;
    const firstItemIndex = previous.index + i - at;
    return { anchor: { keys, index: firstItemIndex }, firstItemIndex, remount: false };
  }
  return { anchor: { keys, index: base }, firstItemIndex: base, remount: true };
}
