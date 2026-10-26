export type MaskAction = 'mask' | 'warn' | 'block';
export const PERSONAL_KINDS = ['email', 'phone', 'idCard', 'bankCard', 'ip'] as const;
export type PersonalKind = (typeof PERSONAL_KINDS)[number];

export interface PrivacyMaskSettings {
  enabled: boolean;
  secrets: { enabled: boolean; action: MaskAction; shape: boolean };
  personal: { enabled: boolean; action: MaskAction; kinds: PersonalKind[] };
  custom: { words: string[]; rules: string[]; action: MaskAction };
  allow: string[];
}

export const DEFAULT_PRIVACY_MASK_SETTINGS: PrivacyMaskSettings = {
  enabled: false,
  secrets: { enabled: true, action: 'mask', shape: false },
  personal: { enabled: false, action: 'mask', kinds: ['email', 'phone', 'idCard', 'bankCard'] },
  custom: { words: [], rules: [], action: 'mask' },
  allow: [],
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const action = (v: unknown): MaskAction =>
  v === 'mask' || v === 'warn' || v === 'block' ? v : 'mask';
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.flatMap((x) => (typeof x === 'string' && x.trim() ? [x.trim()] : [])))]
    : [];

export function parsePrivacyMaskSettings(value: unknown): PrivacyMaskSettings {
  const d = DEFAULT_PRIVACY_MASK_SETTINGS;
  const v = rec(value);
  const s = rec(v.secrets);
  const p = rec(v.personal);
  const c = rec(v.custom);
  return {
    enabled: bool(v.enabled, d.enabled),
    secrets: {
      enabled: bool(s.enabled, d.secrets.enabled),
      action: action(s.action),
      shape: bool(s.shape, d.secrets.shape),
    },
    personal: {
      enabled: bool(p.enabled, d.personal.enabled),
      action: action(p.action),
      kinds: Array.isArray(p.kinds)
        ? (strings(p.kinds).filter((k) =>
            (PERSONAL_KINDS as readonly string[]).includes(k)
          ) as PersonalKind[])
        : [...d.personal.kinds],
    },
    custom: { words: strings(c.words), rules: strings(c.rules), action: action(c.action) },
    allow: strings(v.allow),
  };
}
