import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyConfigEnv,
  CONFIG_FILE,
  configEnv,
  parseServerConfig,
  readServerConfig,
  writeServerConfig,
} from './config';

describe('parseServerConfig', () => {
  it('reads relay, registry and web settings', () => {
    const text = `
relay_url = "https://relay.example.com"
npm_registry = "https://registry.example.com"

[web]
host = "0.0.0.0"
port = 9000
public_url = "https://enso.example.com"
`;
    expect(parseServerConfig(text)).toEqual({
      ok: true,
      config: {
        relayUrl: 'https://relay.example.com',
        npmRegistry: 'https://registry.example.com',
        web: { enabled: true, host: '0.0.0.0', port: 9000, publicUrl: 'https://enso.example.com' },
      },
    });
    expect(parseServerConfig('[web]\nenabled = false\nport = 1')).toEqual({
      ok: true,
      config: { web: { enabled: false, port: 1 } },
    });
    expect(parseServerConfig('')).toEqual({ ok: true, config: {} });
  });

  it('rejects bad syntax, wrong types and unknown keys', () => {
    expect(parseServerConfig('relay_url = ')).toMatchObject({ ok: false });
    expect(parseServerConfig('relay_url = 1')).toEqual({
      ok: false,
      error: 'relay_url 应为字符串',
    });
    expect(parseServerConfig('[web]\nport = "80"')).toEqual({
      ok: false,
      error: 'web.port 应为整数',
    });
    expect(parseServerConfig('relay = "x"')).toEqual({ ok: false, error: '未知配置项: relay' });
    expect(parseServerConfig('[web]\npublic = "x"')).toEqual({
      ok: false,
      error: '未知配置项: web.public',
    });
  });
});

describe('config env', () => {
  it('maps to env and fills only unset keys', () => {
    const config = {
      relayUrl: 'https://relay.example.com',
      web: { enabled: true, port: 9000, publicUrl: 'https://enso.example.com' },
    };
    expect(configEnv(config)).toEqual({
      ENSO_RELAY_URL: 'https://relay.example.com',
      ENSO_WEB: '1',
      ENSO_WEB_PORT: '9000',
      ENSO_PUBLIC_URL: 'https://enso.example.com',
    });
    const env: Record<string, string | undefined> = { ENSO_WEB_PORT: '7000', ENSO_RELAY_URL: '' };
    applyConfigEnv(env, config);
    expect(env).toEqual({
      ENSO_RELAY_URL: 'https://relay.example.com',
      ENSO_WEB: '1',
      ENSO_WEB_PORT: '7000',
      ENSO_PUBLIC_URL: 'https://enso.example.com',
    });
  });

  it('keeps disabled web settings out of env', () => {
    expect(configEnv({ web: { enabled: false, port: 9000 } })).toEqual({});
  });
});

describe('config file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'enso-config-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('treats a missing file as empty and round-trips writes', () => {
    expect(readServerConfig(dir)).toEqual({ ok: true, config: {} });
    const config = {
      relayUrl: 'https://relay.example.com/"x"',
      web: { enabled: true, host: '127.0.0.1', port: 7878, publicUrl: 'https://a.example.com' },
    };
    const file = writeServerConfig(dir, config);
    expect(file).toBe(path.join(dir, CONFIG_FILE));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toMatch(/^# /);
    expect(readServerConfig(dir)).toEqual({ ok: true, config });
  });

  it('reports the file path on errors', () => {
    writeFileSync(path.join(dir, CONFIG_FILE), 'port = 1');
    expect(readServerConfig(dir)).toEqual({
      ok: false,
      error: `${path.join(dir, CONFIG_FILE)}: 未知配置项: port`,
    });
  });
});
