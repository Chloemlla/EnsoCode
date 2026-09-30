export interface WinVk {
  vk: number;
  extended: boolean;
}

// 模型多按 mac 习惯写 cmd/option：Windows 上对应 Ctrl/Alt；要按 Win 键请写 win/meta/super
const MODIFIERS: Record<string, number> = {
  control: 0x11,
  ctrl: 0x11,
  cmd: 0x11,
  command: 0x11,
  shift: 0x10,
  alt: 0x12,
  option: 0x12,
  meta: 0x5b,
  win: 0x5b,
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
  del: 0x2e,
  forwarddelete: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  arrowleft: 0x25,
  arrowup: 0x26,
  arrowright: 0x27,
  arrowdown: 0x28,
  ';': 0xba,
  '=': 0xbb,
  ',': 0xbc,
  '-': 0xbd,
  '.': 0xbe,
  '/': 0xbf,
  '`': 0xc0,
  '[': 0xdb,
  '\\': 0xdc,
  ']': 0xdd,
  "'": 0xde,
};

// 这些 VK 在键盘上属于扩展区，SendInput 不带扩展位会被当成小键盘键
const EXTENDED = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5b]);

export function resolveWinKey(key: string): {
  code: number | undefined;
  modifier: boolean;
  extended: boolean;
} {
  const k = key.trim().toLowerCase();
  let code: number | undefined;
  let modifier = false;
  if (k in MODIFIERS) {
    code = MODIFIERS[k];
    modifier = true;
  } else if (k in KEYS) code = KEYS[k];
  else if (k.length === 1 && ((k >= 'a' && k <= 'z') || (k >= '0' && k <= '9'))) {
    code = k.toUpperCase().charCodeAt(0);
  } else {
    const fn = /^f([1-9]|1[0-2])$/.exec(k);
    if (fn) code = 0x6f + Number(fn[1]);
  }
  return { code, modifier, extended: code !== undefined && EXTENDED.has(code) };
}

export function splitWinChord(keys: string[]): {
  modifiers: WinVk[];
  keys: WinVk[];
  unmapped: string[];
} {
  const modifiers: WinVk[] = [];
  const codes: WinVk[] = [];
  const unmapped: string[] = [];
  for (const key of keys) {
    const resolved = resolveWinKey(key);
    if (resolved.code === undefined) {
      unmapped.push(key);
      continue;
    }
    const entry = { vk: resolved.code, extended: resolved.extended };
    if (resolved.modifier) modifiers.push(entry);
    else codes.push(entry);
  }
  return { modifiers, keys: codes, unmapped };
}
