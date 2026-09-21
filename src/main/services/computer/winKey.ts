const MODIFIERS: Record<string, number> = {
  control: 0x11,
  ctrl: 0x11,
  shift: 0x10,
  alt: 0x12,
  option: 0x12,
  meta: 0x5b,
  win: 0x5b,
  cmd: 0x5b,
  command: 0x5b,
  super: 0x5b,
};

const KEYS: Record<string, number> = {
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  space: 0x20,
  escape: 0x1b,
  esc: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
};

export function resolveWinKey(key: string): { code: number | undefined; modifier: boolean } {
  const k = key.trim().toLowerCase();
  if (k in MODIFIERS) return { code: MODIFIERS[k], modifier: true };
  if (k in KEYS) return { code: KEYS[k], modifier: false };
  if (k.length === 1 && k >= 'a' && k <= 'z') {
    return { code: k.toUpperCase().charCodeAt(0), modifier: false };
  }
  if (k.length === 1 && k >= '0' && k <= '9') {
    return { code: k.charCodeAt(0), modifier: false };
  }
  return { code: undefined, modifier: false };
}

export function splitWinChord(keys: string[]): { modifiers: number[]; keys: number[] } {
  const modifiers: number[] = [];
  const codes: number[] = [];
  for (const key of keys) {
    const resolved = resolveWinKey(key);
    if (resolved.code === undefined) continue;
    if (resolved.modifier) modifiers.push(resolved.code);
    else codes.push(resolved.code);
  }
  return { modifiers, keys: codes };
}
