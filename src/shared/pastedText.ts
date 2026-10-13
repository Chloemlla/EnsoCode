/** 粘贴纯文本转 txt 附件的门槛（参考 lody）：统一换行、去首尾空白后计数 */
export const PASTED_TEXT_FILE_MIN_CHARS = 50_000;
/** IPC 单次上限，超出则保持原样插入正文 */
export const PASTED_TEXT_FILE_MAX_CHARS = 20_000_000;
export const PASTED_TEXT_FILE_NAME = 'pasted-text.txt';

export type PastedTextFileResult =
  | { ok: true; path: string; chars: number; lines: number }
  | { ok: false; error: string };

/** 达到门槛时返回要落盘的规范化文本，否则 null（走原有插入正文） */
export function pastedTextFileContent(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  return normalized.length >= PASTED_TEXT_FILE_MIN_CHARS &&
    normalized.length <= PASTED_TEXT_FILE_MAX_CHARS
    ? normalized
    : null;
}

/**
 * 发出的正文里的 @<Main 生成的粘贴文件绝对路径>：userData 可能含空格（Application Support），
 * 按空白切分会断开，这里按固定尾部形态整体识别，仅供气泡/标题显示用
 */
const PASTED_TEXT_REF =
  /@((?:\/|[A-Za-z]:\\)[^\n@]*?[\\/]pasted-text[\\/](?:bot-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\\/][0-9a-f]{8}[\\/]pasted-text\.txt)/g;

export function splitPastedTextRefs(
  text: string
): ({ type: 'text'; text: string } | { type: 'file'; path: string })[] {
  const segments: ({ type: 'text'; text: string } | { type: 'file'; path: string })[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PASTED_TEXT_REF)) {
    if (match.index > cursor)
      segments.push({ type: 'text', text: text.slice(cursor, match.index) });
    segments.push({ type: 'file', path: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length || segments.length === 0)
    segments.push({ type: 'text', text: text.slice(cursor) });
  return segments;
}

export function stripPastedTextRefs(text: string): string {
  return text.replace(PASTED_TEXT_REF, '');
}
