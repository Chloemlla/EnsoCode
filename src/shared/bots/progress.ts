/** 进度文本里第一个 #N（N 为任务编号）切成 [前, #N, 后]，供渲染成可点的任务引用；没有返回 undefined */
export function splitTaskRef(text: string, seq: number): [string, string, string] | undefined {
  const match = new RegExp(`#${seq}(?!\\d)`).exec(text);
  if (!match) return undefined;
  const end = match.index + match[0].length;
  return [text.slice(0, match.index), match[0], text.slice(end)];
}
