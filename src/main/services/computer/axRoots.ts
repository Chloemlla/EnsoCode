const AX_ROOT_ATTRS = ['AXWindows', 'AXMainWindow', 'AXFocusedWindow', 'AXChildren'] as const;

/** System Settings 常返回空的 AXWindows；空数组也算失败，继续 Main/Focused/Children。 */
export function collectAxRoots<T>(read: (attr: (typeof AX_ROOT_ATTRS)[number]) => T[]): T[] {
  for (const attr of AX_ROOT_ATTRS) {
    const roots = read(attr);
    if (roots.length > 0) return roots;
  }
  return [];
}
