/** CFNumberGetValue type. 6 = kCFNumberFloat64Type. 4 is SInt64 — do not read those bytes as double. */
export const kCFNumberFloat64Type = 6;

export function decodeCfNumberAsFloat64(bytes: Buffer): number {
  return bytes.readDoubleLE(0);
}
