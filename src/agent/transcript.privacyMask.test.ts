import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { PRIVACY_MASK_ENTRY } from '@shared/privacyMask/report';
import { describe, expect, it } from 'vitest';
import { projectMessage } from './projection';
import { withPrivacyMask } from './transcript';

const report = (count: number) => ({
  hits: [
    {
      kind: 'EMAIL',
      rule: 'email',
      action: 'mask',
      where: 'user',
      token: 'abcdefgh',
      preview: '…(11)',
      count,
    },
  ],
  blocked: false,
  restored: 0,
});
const record = (count: number) => ({
  at: 1,
  provider: 'p',
  model: 'm',
  source: 'session',
  report: report(count),
});

describe('withPrivacyMask', () => {
  it('attaches preceding mask entries to the next assistant message and merges retries', () => {
    const user = { role: 'user', content: 'hi' };
    const a1 = { role: 'assistant', content: [] };
    const a2 = { role: 'assistant', content: [] };
    const branch = [
      { type: 'message', id: 'u', message: user },
      { type: 'custom', id: 'c1', customType: PRIVACY_MASK_ENTRY, data: record(1) },
      { type: 'custom', id: 'c2', customType: PRIVACY_MASK_ENTRY, data: record(2) },
      { type: 'message', id: 'a1', message: a1 },
      { type: 'custom', id: 'bad', customType: PRIVACY_MASK_ENTRY, data: { nope: true } },
      { type: 'message', id: 'a2', message: a2 },
    ] as unknown as SessionEntry[];
    const out = withPrivacyMask([user, a1, a2], branch) as Array<Record<string, unknown>>;
    expect(out[0]).toBe(user);
    expect(out[1].privacyMask).toMatchObject({ hits: [{ count: 3 }] });
    expect(out[2]).toBe(a2);
    expect(projectMessage(out[1])?.privacyMask).toMatchObject({ hits: [{ count: 3 }] });
  });
});
