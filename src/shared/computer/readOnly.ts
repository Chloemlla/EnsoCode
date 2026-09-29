/** 只读跑允许的 guest 方法。其它桌面副作用一律拒绝；剪贴板可能有密码，不算只读。 */
export const READ_ONLY_ALLOWED = new Set([
  'windows',
  'window',
  'focusedWindow',
  'displays',
  'capabilities',
  'screenshot',
  'ax',
  'getState',
  'app',
  'find',
  'ref',
  'elementAt',
  'focusedElement',
  'axBounds',
  'axAttributes',
  'axActions',
  'axParent',
  'axChildren',
  'wait',
]);

export function isReadOnlyAllowed(method: string): boolean {
  return READ_ONLY_ALLOWED.has(method);
}
