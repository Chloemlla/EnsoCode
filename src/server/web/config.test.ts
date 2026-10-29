import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_PORT, parseWebConfig } from './config';

describe('parseWebConfig', () => {
  it('is off by default', () => {
    expect(parseWebConfig([], {})).toEqual({ ok: true, web: null });
  });

  it('listens on loopback by default once enabled', () => {
    expect(parseWebConfig(['--web'], {})).toEqual({
      ok: true,
      web: {
        host: '127.0.0.1',
        port: DEFAULT_WEB_PORT,
        localUrl: `http://127.0.0.1:${DEFAULT_WEB_PORT}`,
        publicUrl: `http://127.0.0.1:${DEFAULT_WEB_PORT}`,
      },
    });
    expect(parseWebConfig([], { ENSO_WEB: '1' })).toMatchObject({
      ok: true,
      web: { port: DEFAULT_WEB_PORT },
    });
    expect(parseWebConfig([], { ENSO_WEB: 'off' })).toEqual({ ok: true, web: null });
  });

  it('takes env and lets flags override it', () => {
    const env = {
      ENSO_WEB: 'true',
      ENSO_WEB_HOST: '0.0.0.0',
      ENSO_WEB_PORT: '9000',
      ENSO_PUBLIC_URL: 'https://a.example.com/',
    };
    expect(parseWebConfig([], env)).toEqual({
      ok: true,
      web: {
        host: '0.0.0.0',
        port: 9000,
        localUrl: 'http://127.0.0.1:9000',
        publicUrl: 'https://a.example.com',
      },
    });
    expect(
      parseWebConfig(
        ['--web-port=9100', '--web-host', '::', '--public-url', 'https://b.example.com'],
        env
      )
    ).toEqual({
      ok: true,
      web: {
        host: '::',
        port: 9100,
        localUrl: 'http://[::1]:9100',
        publicUrl: 'https://b.example.com',
      },
    });
  });

  it('enables web when any web option is given', () => {
    expect(parseWebConfig(['--public-url', 'https://c.example.com'], {})).toMatchObject({
      ok: true,
      web: { host: '127.0.0.1', publicUrl: 'https://c.example.com' },
    });
    expect(parseWebConfig(['--web-port', '9001'], {})).toMatchObject({
      ok: true,
      web: { port: 9001 },
    });
    expect(parseWebConfig([], { ENSO_WEB_HOST: '0.0.0.0' })).toMatchObject({
      ok: true,
      web: { host: '0.0.0.0' },
    });
  });

  it('rejects bad input', () => {
    for (const [argv, env] of [
      [['--web', '--web-port', '0'], {}],
      [['--web', '--web-port=70000'], {}],
      [['--web', '--web-port', 'x'], {}],
      [['--public-url', 'ftp://x'], {}],
      [['--public-url', 'https://x.example.com/enso'], {}],
      [['--public-url'], {}],
      [['--bogus'], {}],
      [[], { ENSO_WEB: '1', ENSO_WEB_PORT: '-1' }],
    ] as [string[], Record<string, string>][]) {
      expect(parseWebConfig(argv, env).ok, JSON.stringify([argv, env])).toBe(false);
    }
  });
});
