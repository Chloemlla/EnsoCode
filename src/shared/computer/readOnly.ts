/** 只读跑允许的 guest 方法。其它桌面副作用一律拒绝。 */
export const READ_ONLY_ALLOWED = new Set([
  'windows',
  'window',
  'focusedWindow',
  'displays',
  'capabilities',
  'screenshot',
  'ax',
  'find',
  'ref',
  'elementAt',
  'focusedElement',
  'clipboard.read',
  'value',
  'bounds',
  'attributes',
  'actions',
  'parent',
  'children',
  'wait',
  'assert',
]);

export function isReadOnlyAllowed(method: string): boolean {
  return READ_ONLY_ALLOWED.has(method);
}
