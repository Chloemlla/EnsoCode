import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY_MASK_SETTINGS, type PrivacyMaskSettings } from './settings';
import { MaskReportBuilder, PrivacyVault } from './vault';

const digest = (data: string) => new Uint8Array(createHmac('sha256', 'k').update(data).digest());
const settings = (patch: Partial<PrivacyMaskSettings> = {}): PrivacyMaskSettings => ({
  ...DEFAULT_PRIVACY_MASK_SETTINGS,
  enabled: true,
  secrets: { enabled: true, action: 'mask', shape: false },
  personal: { enabled: true, action: 'mask', kinds: ['email', 'phone'] },
  ...patch,
});
const vault = (patch?: Partial<PrivacyMaskSettings>) => {
  const v = new PrivacyVault({ digest });
  v.configure(settings(patch));
  return v;
};
const KEY = 'sk-proj-AbCdEfGh1234567890IjKlMnOp';

describe('privacy vault', () => {
  it('produces stable placeholders and round-trips', () => {
    const v = vault();
    const r = new MaskReportBuilder();
    const a = v.mask(`use ${KEY} and bob@corp.io`, 'user', r);
    expect(a).toMatch(/^use \{\{API_KEY_[a-z2-7]{8}\}\} and \{\{EMAIL_[a-z2-7]{8}\}\}$/);
    expect(v.mask(`again ${KEY}`, 'user', r)).toBe(`again ${a.split(' ')[1]}`);
    expect(v.restore(a)).toBe(`use ${KEY} and bob@corp.io`);
    expect(v.mask(a, 'user', r)).toBe(a);
  });

  it('is stable across instances with the same key', () => {
    expect(vault().mask(KEY, 'user', new MaskReportBuilder())).toBe(
      vault().mask(KEY, 'user', new MaskReportBuilder())
    );
  });

  it('restores tolerant placeholder spellings', () => {
    const v = vault();
    const p = v.mask(KEY, 'user', new MaskReportBuilder());
    const [, kind, hash] = /\{\{(.+)_(\w{8})\}\}/.exec(p) ?? [];
    for (const variant of [
      `{{ ${kind}_${hash} }}`,
      `{${kind}_${hash}}`,
      `${kind}_${hash.toUpperCase()}`,
      `{{${kind.toLowerCase()}_${hash}}}`,
    ])
      expect(v.restore(`x ${variant} y`)).toBe(`x ${KEY} y`);
    expect(v.restore('SOME_abcdefgh {{API_KEY_zzzzzzzz}}')).toBe(
      'SOME_abcdefgh {{API_KEY_zzzzzzzz}}'
    );
  });

  it('re-masks known values even without rule context', () => {
    const v = vault();
    const r = new MaskReportBuilder();
    const p = v.mask('password="Zx9kq77abc"', 'user', r);
    expect(v.maskKnown('thinking about Zx9kq77abc')).toBe(
      `thinking about ${p.slice('password="'.length, -1)}`
    );
    expect(v.mask('it was Zx9kq77abc', 'assistant', r)).toContain('{{PASSWORD_');
  });

  it('warn leaves text and records; block records once then masks', () => {
    const v = vault({ personal: { enabled: true, action: 'warn', kinds: ['email'] } });
    const r = new MaskReportBuilder();
    expect(v.mask('bob@corp.io', 'tool_result', r)).toBe('bob@corp.io');
    expect(r.build().hits).toMatchObject([{ kind: 'EMAIL', action: 'warn', where: 'tool_result' }]);

    const b = vault({ secrets: { enabled: true, action: 'block', shape: false } });
    const r1 = new MaskReportBuilder();
    expect(b.mask(KEY, 'tool_result', r1)).not.toContain(KEY);
    expect(r1.build().blocked).toBe(true);
    const r2 = new MaskReportBuilder();
    b.mask(KEY, 'tool_result', r2);
    expect(r2.build()).toMatchObject({ blocked: false, hits: [{ action: 'mask' }] });
  });

  it('does not block values that were already sent masked', () => {
    const v = vault();
    v.mask(KEY, 'user', new MaskReportBuilder());
    v.configure(settings({ secrets: { enabled: true, action: 'block', shape: false } }));
    const r = new MaskReportBuilder();
    expect(v.mask(`again ${KEY}`, 'user', r)).not.toContain(KEY);
    expect(r.build()).toMatchObject({ blocked: false, hits: [{ action: 'mask' }] });
  });

  it('never leaks raw values into reports', () => {
    const v = vault();
    const r = new MaskReportBuilder();
    for (let i = 0; i < 20; i++) {
      const key = `sk-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
      v.mask(`k ${key}`, 'user', r);
      expect(JSON.stringify(r.build())).not.toContain(key.slice(3));
    }
    expect(r.build().hits[0]).toMatchObject({ preview: expect.stringMatching(/^sk-…\(\d+\)$/) });
  });

  it('aggregates hits by kind, rule, action, where and token', () => {
    const v = vault();
    const r = new MaskReportBuilder();
    v.mask(`${KEY} ${KEY}`, 'user', r);
    v.mask(KEY, 'user', r);
    expect(r.build().hits).toHaveLength(1);
    expect(r.build().hits[0].count).toBe(3);
  });

  describe('shape', () => {
    const shaped = () => vault({ secrets: { enabled: true, action: 'mask', shape: true } });

    it('keeps prefix, length, separators and char classes', () => {
      const v = shaped();
      const fake = v.mask(KEY, 'user', new MaskReportBuilder());
      expect(fake).not.toBe(KEY);
      expect(fake.startsWith('sk-proj-')).toBe(true);
      expect(fake).toHaveLength(KEY.length);
      const cls = (c: string) =>
        /[A-Z]/.test(c) ? 'A' : /[a-z]/.test(c) ? 'a' : /\d/.test(c) ? '0' : c;
      expect([...fake].map(cls)).toEqual([...KEY].map(cls));
      expect(v.restore(`x ${fake} y`)).toBe(`x ${KEY} y`);
      expect(shaped().mask(KEY, 'user', new MaskReportBuilder())).toBe(fake);
    });

    it('falls back to placeholder for non-shapeable values', () => {
      const v = shaped();
      expect(v.mask('password="hunter2 hunter2"', 'user', new MaskReportBuilder())).toMatch(
        /\{\{PASSWORD_/
      );
    });
  });

  describe('holdLength', () => {
    it('holds partial placeholders and known fake prefixes only', () => {
      const v = vault({ secrets: { enabled: true, action: 'mask', shape: true } });
      const fake = v.mask(KEY, 'user', new MaskReportBuilder());
      expect(v.holdLength('hello {{API_KE')).toBe('{{API_KE'.length);
      expect(v.holdLength('hello {')).toBe(1);
      expect(v.holdLength('hello {{API_KEY_abcdefgh}}')).toBe(0);
      expect(v.holdLength('hello {{ not a placeholder')).toBe(0);
      expect(v.holdLength(`token ${fake.slice(0, 12)}`)).toBe(12);
      expect(v.holdLength('token skx')).toBe(0);
    });
  });
});
