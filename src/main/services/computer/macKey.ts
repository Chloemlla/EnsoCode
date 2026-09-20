const MODIFIERS: Record<string, number> = {
  meta: 55,
  cmd: 55,
  command: 55,
  super: 55,
  win: 55,
  shift: 56,
  option: 58,
  alt: 58,
  control: 59,
  ctrl: 59,
};

const KEYS: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '6': 22,
  '5': 23,
  equal: 24,
  '9': 25,
  '7': 26,
  minus: 27,
  '8': 28,
  '0': 29,
  o: 31,
  u: 32,
  i: 34,
  p: 35,
  enter: 36,
  return: 36,
  l: 37,
  j: 38,
  k: 40,
  ';': 41,
  n: 45,
  m: 46,
  tab: 48,
  space: 49,
  escape: 53,
  esc: 53,
  delete: 51,
  backspace: 51,
};

export function resolveMacKey(key: string): { code: number | undefined; modifier: boolean } {
  const k = key.trim().toLowerCase();
  if (k in MODIFIERS) return { code: MODIFIERS[k], modifier: true };
  if (k in KEYS) return { code: KEYS[k], modifier: false };
  return { code: undefined, modifier: false };
}

export const MAC_EVENT_FLAG = {
  shift: 0x0002_0000,
  control: 0x0004_0000,
  alternate: 0x0008_0000,
  command: 0x0010_0000,
} as const;

export function macEventFlags(keys: string[]): number {
  let flags = 0;
  for (const key of keys) {
    const k = key.trim().toLowerCase();
    if (k === 'meta' || k === 'cmd' || k === 'command' || k === 'super' || k === 'win') {
      flags |= MAC_EVENT_FLAG.command;
    } else if (k === 'shift') {
      flags |= MAC_EVENT_FLAG.shift;
    } else if (k === 'option' || k === 'alt') {
      flags |= MAC_EVENT_FLAG.alternate;
    } else if (k === 'control' || k === 'ctrl') {
      flags |= MAC_EVENT_FLAG.control;
    }
  }
  return flags;
}

export function splitMacChord(keys: string[]): {
  modifiers: number[];
  keys: number[];
  flags: number;
} {
  const modifiers: number[] = [];
  const codes: number[] = [];
  for (const key of keys) {
    const resolved = resolveMacKey(key);
    if (resolved.code === undefined) continue;
    if (resolved.modifier) modifiers.push(resolved.code);
    else codes.push(resolved.code);
  }
  return { modifiers, keys: codes, flags: macEventFlags(keys) };
}

export function splitTypeSegments(
  text: string
): Array<{ kind: 'ascii' | 'unicode'; text: string }> {
  const segments: Array<{ kind: 'ascii' | 'unicode'; text: string }> = [];
  for (const char of text) {
    const kind = char.charCodeAt(0) < 128 ? 'ascii' : 'unicode';
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += char;
    else segments.push({ kind, text: char });
  }
  return segments;
}

export function macKeyForAsciiChar(char: string): { code: number; flags: number } | undefined {
  if (char.length !== 1) return undefined;
  if (char >= 'A' && char <= 'Z') {
    const code = KEYS[char.toLowerCase()];
    if (code === undefined) return undefined;
    return { code, flags: MAC_EVENT_FLAG.shift };
  }
  if (char === ' ') return { code: KEYS.space, flags: 0 };
  const code = KEYS[char];
  if (code === undefined) return undefined;
  return { code, flags: 0 };
}
