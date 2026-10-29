const PARTITION_SUFFIX = '-browser';

export function partitionName(isPackaged: boolean): string {
  return `persist:${isPackaged ? 'enso' : 'enso-dev'}${PARTITION_SUFFIX}`;
}

/** clear* 前再校验一遍：只准动我们自己的罐。 */
export function isBrowserPartition(name: string): boolean {
  return name.startsWith('persist:') && name.endsWith(PARTITION_SUFFIX);
}
