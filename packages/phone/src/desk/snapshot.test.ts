import { describe, expect, it } from 'vitest';
import { absolutizeCssUrls, packReads, snapshotReady, unpackReads } from './snapshot';

const base = {
  elapsed: 1000,
  liveChars: 0,
  snapChars: 5000,
  settingsLoaded: true,
  stableFor: 0,
  liveLoading: false,
};

describe('snapshotReady', () => {
  it('keeps the snapshot until the live renderer has its settings', () => {
    expect(
      snapshotReady({ ...base, settingsLoaded: false, liveChars: 9000, stableFor: 5000 })
    ).toBe(false);
  });

  it('switches once the live page shows most of the snapshot content', () => {
    expect(snapshotReady({ ...base, liveChars: 3000 })).toBe(false);
    expect(snapshotReady({ ...base, liveChars: 4200 })).toBe(true);
  });

  it('switches when content shrank but the live page has settled', () => {
    expect(snapshotReady({ ...base, liveChars: 1000, stableFor: 1000 })).toBe(false);
    expect(snapshotReady({ ...base, liveChars: 1000, stableFor: 2500 })).toBe(true);
  });

  it('keeps covering while the live timeline still shows its loading state', () => {
    expect(snapshotReady({ ...base, liveChars: 9000, stableFor: 9000, liveLoading: true })).toBe(
      false
    );
  });

  it('never blocks forever', () => {
    expect(snapshotReady({ ...base, settingsLoaded: false, elapsed: 20_000 })).toBe(true);
  });
});

describe('absolutizeCssUrls', () => {
  it('resolves relative url() against the stylesheet, leaving absolute/data urls alone', () => {
    const css =
      "@font-face{src:url(./KaTeX.woff2) format('woff2'),url(\"../x/y.ttf\")}a{background:url('data:image/png;base64,AA')}b{background:url(/abs.png)}c{background:url(#m)}";
    expect(absolutizeCssUrls(css, 'https://h/desk/r/p/v/assets/index.css')).toBe(
      '@font-face{src:url("https://h/desk/r/p/v/assets/KaTeX.woff2") format(\'woff2\'),url("https://h/desk/r/p/v/x/y.ttf")}a{background:url(\'data:image/png;base64,AA\')}b{background:url(/abs.png)}c{background:url(#m)}'
    );
  });
});

describe('packReads / unpackReads', () => {
  const entry = (n: number) => ({ h: `h${n}`, json: 'x'.repeat(n) });

  it('round-trips and keeps the most recent entries within the budget', () => {
    const reads = new Map([
      ['a', entry(40)],
      ['b', entry(30)],
      ['c', entry(20)],
    ]);
    const restored = unpackReads(packReads(reads, 60));
    expect([...restored.keys()]).toEqual(['b', 'c']);
    expect(restored.get('c')).toEqual(entry(20));
  });

  it('ignores malformed input', () => {
    expect(unpackReads('nope').size).toBe(0);
    expect(
      unpackReads(
        JSON.stringify([
          ['k', { h: 1 }],
          ['ok', { h: 'h', json: '1' }],
        ])
      ).size
    ).toBe(1);
  });
});
