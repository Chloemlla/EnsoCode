const TITLE_CHARS = 30;

/** 话题缺省标题：首条人类消息的首个非空行 */
export function threadTitleFrom(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((item) => item.replace(/\s+/gu, ' ').trim())
    .find(Boolean);
  if (!line) return undefined;
  const chars = [...line];
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS).join('')}…` : line;
}
