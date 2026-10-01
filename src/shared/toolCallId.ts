/** pi 嵌套调用（codemode 脚本内）id 为 `<parent>/<n>` */
export function nestedToolCallParent(toolCallId: string): string | undefined {
  return /^(.+)\/\d+$/.exec(toolCallId)?.[1];
}

export const isNestedToolCallId = (toolCallId: string): boolean =>
  nestedToolCallParent(toolCallId) !== undefined;
