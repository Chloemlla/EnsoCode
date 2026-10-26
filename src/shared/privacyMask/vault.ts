import type { MaskReportBuilder, MaskWhere } from './report';
import { type CompiledRules, compileRules, escapeRegExp, findSpans, type MaskSpan } from './rules';
import type { PrivacyMaskSettings } from './settings';

export { MaskReportBuilder } from './report';

export interface PrivacyVaultDeps {
  /** 同步、带密钥的摘要（≥5 字节）；worker 用 HMAC，预览可用非密码学哈希 */
  digest(data: string): Uint8Array;
  maxValues?: number;
}

interface Entry {
  kind: string;
  value: string;
  /** 发出去的替身：占位符或假 key */
  stand: string;
  hash: string;
  rule: string;
  keep: number;
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32(bytes: Uint8Array, chars: number): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= chars) break;
  }
  return out;
}

const PLACEHOLDER_ANY =
  /\{\{\s*([A-Za-z][A-Za-z_]*?)_([A-Za-z2-7]{8})\s*\}\}|\{\s*([A-Za-z][A-Za-z_]*?)_([A-Za-z2-7]{8})\s*\}|(?<![A-Za-z0-9_{])([A-Za-z][A-Za-z_]*?)_([A-Za-z2-7]{8})(?![A-Za-z0-9_}])/g;
const PARTIAL_PLACEHOLDER = /^\{\{?\s*(?:[A-Za-z][A-Za-z_]*(?:_[A-Za-z2-7]{0,8})?)?\s*\}?$/;
const SHAPEABLE = /^[A-Za-z0-9._-]+$/;
const KEY_RUN = /[A-Za-z0-9._-]+$/;
const MIN_SHAPE = 8;
const MIN_RANDOM = 6;
/** 已知值复用的最短长度：太短会误伤普通单词 */
const MIN_KNOWN = 8;

export const previewOf = (value: string, keep: number) =>
  `${value.slice(0, keep)}…(${value.length})`;

export class PrivacyVault {
  private readonly digest: PrivacyVaultDeps['digest'];
  private readonly maxValues: number;
  private compiled: CompiledRules = compileRules({
    enabled: false,
    secrets: { enabled: false, action: 'mask', shape: false },
    personal: { enabled: false, action: 'mask', kinds: [] },
    custom: { words: [], rules: [], action: 'mask' },
    allow: [],
  });
  private shape = false;
  private settingsKey = '';
  /** id(kind\0value) → entry；插入序即淘汰序 */
  private readonly entries = new Map<string, Entry>();
  /** 占位符 / 假 key → entry，供还原 */
  private readonly stands = new Map<string, Entry>();
  /** 当前配置下可复用的已知值（换配置清空，允许名单立即生效） */
  private readonly known = new Map<string, Entry>();
  private readonly blocked = new Set<string>();
  private knownRe: RegExp | null | undefined;
  private knownByValue = new Map<string, Entry>();
  private fakeRe: RegExp | null | undefined;

  constructor(deps: PrivacyVaultDeps) {
    this.digest = deps.digest;
    this.maxValues = deps.maxValues ?? 5000;
  }

  configure(settings: PrivacyMaskSettings): void {
    const key = JSON.stringify(settings);
    if (key === this.settingsKey) return;
    this.settingsKey = key;
    this.compiled = compileRules(settings);
    this.shape = settings.secrets.shape;
    this.known.clear();
    this.knownRe = undefined;
  }

  get active(): boolean {
    return this.compiled.active;
  }

  /** 有可还原的值时才需要处理回包 */
  get hasValues(): boolean {
    return this.stands.size > 0;
  }

  findSpans(text: string): MaskSpan[] {
    return findSpans(text, this.compiled);
  }

  /** allowBlock=false：历史内容早已发出过，拦截改为脱敏（worker 重启后值表为空也不会误拦） */
  mask(text: string, where: MaskWhere, report: MaskReportBuilder, allowBlock = true): string {
    if (!this.compiled.active || !text) return text;
    const spans = findSpans(text, this.compiled);
    let out = '';
    let at = 0;
    for (const span of spans) {
      out += this.maskKnown(text.slice(at, span.start), where, report);
      at = span.end;
      const value = text.slice(span.start, span.end);
      const id = `${span.kind}\0${value}`;
      let action = span.action;
      // 只拦新内容：拦过一次或早已脱敏发出过的值改为脱敏，不卡死会话
      if (action === 'block' && (!allowBlock || this.blocked.has(id) || this.entries.has(id)))
        action = 'mask';
      if (action === 'warn') {
        out += value;
        report.add({
          kind: span.kind,
          rule: span.rule,
          action,
          where,
          token: this.hashOf(span.kind, value),
          preview: previewOf(value, span.keep),
        });
        continue;
      }
      if (action === 'block') {
        this.blocked.add(id);
        report.blocked = true;
      }
      const entry = this.remember(span, value);
      out += entry.stand;
      report.add({
        kind: span.kind,
        rule: span.rule,
        action,
        where,
        token: entry.hash,
        preview: previewOf(value, span.keep),
      });
    }
    return out + this.maskKnown(text.slice(at), where, report);
  }

  /** 只替换已出现过的值，不跑识别规则（thinking 等需要还原厂商原文的场景） */
  maskKnown(text: string, where?: MaskWhere, report?: MaskReportBuilder): string {
    if (!text || !this.known.size) return text;
    const re = this.knownPattern();
    if (!re) return text;
    return text.replace(re, (value) => {
      const entry = this.knownByValue.get(value);
      if (!entry) return value;
      if (where && report)
        report.add({
          kind: entry.kind,
          rule: 'known',
          action: 'mask',
          where,
          token: entry.hash,
          preview: previewOf(value, entry.keep),
        });
      return entry.stand;
    });
  }

  restore(text: string, report?: MaskReportBuilder): string {
    if (!text || !this.stands.size) return text;
    let out = text.replace(PLACEHOLDER_ANY, (m, k1, h1, k2, h2, k3, h3) => {
      const kind = (k1 ?? k2 ?? k3) as string;
      const hash = (h1 ?? h2 ?? h3) as string;
      const entry = this.stands.get(`{{${kind.toUpperCase()}_${hash.toLowerCase()}}}`);
      if (!entry) return m;
      if (report) report.restored++;
      return entry.value;
    });
    const fake = this.fakePattern();
    if (fake)
      out = out.replace(fake, (m) => {
        const entry = this.stands.get(m);
        if (!entry) return m;
        if (report) report.restored++;
        return entry.value;
      });
    return out;
  }

  /** 流式文本末尾需要扣留的字符数：疑似半个占位符或已知假 key 的前缀 */
  holdLength(text: string): number {
    if (!this.stands.size || !text) return 0;
    let hold = 0;
    const tail = text.slice(-48);
    let brace = tail.lastIndexOf('{');
    if (brace > 0 && tail[brace - 1] === '{') brace--;
    if (brace >= 0 && PARTIAL_PLACEHOLDER.test(tail.slice(brace))) hold = tail.length - brace;
    const run = KEY_RUN.exec(tail)?.[0];
    if (run) {
      for (const stand of this.stands.keys())
        if (stand.length > run.length && !stand.startsWith('{{') && stand.startsWith(run)) {
          hold = Math.max(hold, run.length);
          break;
        }
    }
    return hold;
  }

  private hashOf(kind: string, value: string): string {
    return base32(this.digest(`${kind}\0${value}`), 8);
  }

  private remember(span: MaskSpan, value: string): Entry {
    const id = `${span.kind}\0${value}`;
    let entry = this.entries.get(id);
    if (!entry) {
      const hash = this.hashOf(span.kind, value);
      const fake =
        this.shape && span.category === 'secret' ? this.fakeOf(span.kind, value, span.keep) : '';
      entry = {
        kind: span.kind,
        value,
        stand: fake || `{{${span.kind}_${hash}}}`,
        hash,
        rule: span.rule,
        keep: span.keep,
      };
      this.entries.set(id, entry);
      this.stands.set(entry.stand, entry);
      if (fake) this.fakeRe = undefined;
      this.evict();
    }
    if (value.length >= MIN_KNOWN && !this.known.has(id)) {
      this.known.set(id, entry);
      this.knownRe = undefined;
    }
    return entry;
  }

  private fakeOf(kind: string, value: string, keep: number): string {
    if (value.length < MIN_SHAPE || !SHAPEABLE.test(value)) return '';
    const tail = value.slice(keep);
    if ((tail.match(/[A-Za-z0-9]/g)?.length ?? 0) < MIN_RANDOM) return '';
    for (let counter = 0; counter < 8; counter++) {
      let bytes: number[] = [];
      for (let block = 0; bytes.length < tail.length; block++)
        bytes = bytes.concat([...this.digest(`shape\0${kind}\0${value}\0${counter}\0${block}`)]);
      let fake = value.slice(0, keep);
      for (let i = 0; i < tail.length; i++) {
        const c = tail[i];
        const b = bytes[i];
        fake += /[A-Z]/.test(c)
          ? String.fromCharCode(65 + (b % 26))
          : /[a-z]/.test(c)
            ? String.fromCharCode(97 + (b % 26))
            : /\d/.test(c)
              ? String(b % 10)
              : c;
      }
      const clash = this.stands.get(fake);
      if (fake !== value && !clash && ![...this.entries.values()].some((e) => e.value === fake))
        return fake;
    }
    return '';
  }

  private evict(): void {
    while (this.entries.size > this.maxValues) {
      const [id, entry] = this.entries.entries().next().value as [string, Entry];
      this.entries.delete(id);
      this.stands.delete(entry.stand);
      this.known.delete(id);
      this.blocked.delete(id);
      this.knownRe = undefined;
      this.fakeRe = undefined;
    }
  }

  private knownPattern(): RegExp | null {
    if (this.knownRe === undefined) {
      this.knownByValue = new Map([...this.known.values()].map((e) => [e.value, e]));
      const values = [...this.knownByValue.keys()].sort((a, b) => b.length - a.length);
      this.knownRe = values.length ? new RegExp(values.map(escapeRegExp).join('|'), 'g') : null;
    }
    return this.knownRe;
  }

  private fakePattern(): RegExp | null {
    if (this.fakeRe === undefined) {
      const fakes = [...this.stands.keys()]
        .filter((s) => !s.startsWith('{{'))
        .sort((a, b) => b.length - a.length);
      this.fakeRe = fakes.length
        ? new RegExp(
            `(?<![A-Za-z0-9_-])(?:${fakes.map(escapeRegExp).join('|')})(?![A-Za-z0-9_-])`,
            'g'
          )
        : null;
    }
    return this.fakeRe;
  }
}
