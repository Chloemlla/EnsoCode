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

/** koffi 每次拷贝同一 AX 元素都会得到新指针对象，去重必须用 CFEqual。 */
export function splitUniqueRefs<T>(
  values: T[],
  equal: (a: T, b: T) => boolean
): { unique: T[]; duplicates: T[] } {
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const value of values) {
    if (unique.some((kept) => equal(kept, value))) duplicates.push(value);
    else unique.push(value);
  }
  return { unique, duplicates };
}
