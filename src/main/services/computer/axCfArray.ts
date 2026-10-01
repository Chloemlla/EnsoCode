export function isLikelyCfPointer(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'number' || typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0xffff;
  }
  return typeof value === 'object';
}

export function takeOwnedRefs<T>(
  count: number,
  getAt: (index: number) => T | null | undefined,
  retain: (value: T) => void
): T[] {
  const values: T[] = [];
  for (let i = 0; i < count; i++) {
    const item = getAt(i);
    if (item == null || !isLikelyCfPointer(item)) continue;
    retain(item);
    values.push(item);
  }
  return values;
}
