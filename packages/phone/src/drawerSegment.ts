/**
 * 侧栏顶部「项目 / Bot」分段选择的记忆：用户点过哪个标签就记下来，
 * 下次打开侧栏恢复，而不是每次都被正在打开的会话决定。
 */
export const DRAWER_SEGMENT_KEY = 'enso-phone-drawer-segment';

export type DrawerSegment = 'code' | 'bot';

/** 读取记住的分段；脏值当作没存过 */
export function loadDrawerSegment(): DrawerSegment | null {
  const value = localStorage.getItem(DRAWER_SEGMENT_KEY);
  return value === 'bot' || value === 'code' ? value : null;
}

export function saveDrawerSegment(segment: DrawerSegment): void {
  localStorage.setItem(DRAWER_SEGMENT_KEY, segment);
}

/**
 * 打开侧栏时应停在哪个分段：Bot 不可用时恒为项目；否则优先用户记住的标签，
 * 没记过时沿用旧行为——正在看 Bot 聊天就停 Bot，否则回项目。
 */
export function resolveDrawerSegment(botEnabled: boolean, botChatId: string | null): boolean {
  if (!botEnabled) return false;
  const remembered = loadDrawerSegment();
  if (remembered) return remembered === 'bot';
  return botChatId !== null;
}
