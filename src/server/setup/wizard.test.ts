import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readServerConfig, writeServerConfig } from '../config';
import { CADDYFILE, caddyBlock } from './caddy';
import { type Prompt, runConfigWizard, type SetupSystem } from './wizard';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'enso-wizard-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function scripted(answers: string[]) {
  const out: string[] = [];
  const prompt: Prompt = {
    ask: async (question, fallback) => {
      out.push(`? ${question}`);
      if (!answers.length) throw new Error(`unexpected question: ${question}`);
      return answers.shift()?.trim() || fallback || '';
    },
    say: (text) => out.push(text),
  };
  return { prompt, out: () => out.join('\n'), left: () => answers.length };
}

function fakeSystem(overrides: Partial<SetupSystem> = {}) {
  const files = new Map<string, string>();
  const execs: string[] = [];
  const installed = new Set<string>(['apt-get', 'systemctl']);
  let restarted = 0;
  let serviceInstalls = 0;
  const sys: SetupSystem = {
    linux: true,
    root: true,
    has: (cmd) => installed.has(cmd),
    exec: (cmd, args) => {
      execs.push([cmd, ...args].join(' '));
      if (cmd === 'apt-get' && args[0] === 'install') installed.add('caddy');
      return true;
    },
    readFile: (file) => files.get(file) ?? null,
    writeFile: (file, text) => void files.set(file, text),
    publicIp: async () => '23.138.76.150',
    resolve4: async () => ['23.138.76.150'],
    probe: async () => true,
    sleep: async () => {},
    serviceInstalled: () => false,
    serverRunning: async () => false,
    currentRelayUrl: async () => null,
    serviceOverrides: () => [],
    installService: async () => {
      serviceInstalls++;
    },
    restartService: () => {
      restarted++;
      return true;
    },
    ...overrides,
  };
  return {
    sys,
    files,
    execs,
    restarted: () => restarted,
    serviceInstalls: () => serviceInstalls,
  };
}

const saved = () => {
  const result = readServerConfig(dir);
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

describe('runConfigWizard', () => {
  it('reuses a hand-written Caddy site that already proxies here', async () => {
    const { prompt, out, left } = scripted(['4', '', '', '']);
    const hand = '23-138-76-150.nip.io {\n\treverse_proxy 127.0.0.1:7878\n}\n';
    const fake = fakeSystem({
      serviceInstalled: () => true,
      currentRelayUrl: async () => 'https://23-138-76-150.nip.io',
    });
    fake.sys.has = () => true;
    fake.files.set(CADDYFILE, hand);
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(fake.files.get(CADDYFILE)).toBe(hand);
    expect(fake.execs).toEqual([]);
    expect(out()).toContain('沿用');
    expect(out()).not.toContain('手动配置');
    expect(out()).not.toContain('重新配对');
    expect(saved().web?.publicUrl).toBe('https://23-138-76-150.nip.io');
  });

  it('asks to edit a hand-written Caddy site that proxies elsewhere', async () => {
    const { prompt, out, left } = scripted(['4', '', '', 'n']);
    const hand = '23-138-76-150.nip.io {\n\tfile_server\n}\n';
    const fake = fakeSystem();
    fake.sys.has = () => true;
    fake.files.set(CADDYFILE, hand);
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(fake.files.get(CADDYFILE)).toBe(hand);
    expect(fake.execs).toEqual([]);
    expect(out()).toContain('已有 23-138-76-150.nip.io 站点');
  });

  it('re-registers a service whose unit pins settings the config file should own', async () => {
    const { prompt, out, left } = scripted(['', '', '']);
    const fake = fakeSystem({
      serviceInstalled: () => true,
      serviceOverrides: () => ['ENSO_WEB', 'ENSO_PUBLIC_URL'],
    });
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(out()).toContain('ENSO_WEB, ENSO_PUBLIC_URL');
    expect(fake.serviceInstalls()).toBe(1);
    expect(fake.restarted()).toBe(0);
  });

  it('keeps the public relay by default', async () => {
    const { prompt, out, left } = scripted(['', '', 'n']);
    const fake = fakeSystem();
    fake.files.set(CADDYFILE, caddyBlock('old.example.com', 7878));
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(saved()).toEqual({});
    expect(out()).toContain('还有之前配的 enso-server 段');
    expect(fake.execs).toEqual([]);
    expect(fake.serviceInstalls()).toBe(0);
  });

  it('sets up nip.io with a freshly installed Caddy and restarts the service', async () => {
    const { prompt, out, left } = scripted(['4', '', '', '', '']);
    const fake = fakeSystem({ serviceInstalled: () => true });
    fake.files.set(CADDYFILE, ':80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n');
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(saved()).toEqual({
      web: {
        enabled: true,
        host: '127.0.0.1',
        port: 7878,
        publicUrl: 'https://23-138-76-150.nip.io',
      },
    });
    expect(fake.execs).toEqual([
      'apt-get update',
      'apt-get install -y caddy',
      `caddy validate --config ${CADDYFILE} --adapter caddyfile`,
      'systemctl enable caddy',
      'systemctl reload-or-restart caddy',
    ]);
    expect(fake.files.get(CADDYFILE)).toContain(
      '23-138-76-150.nip.io {\n\treverse_proxy 127.0.0.1:7878\n}'
    );
    expect(fake.files.get(CADDYFILE)).not.toContain('/usr/share/caddy');
    expect(fake.restarted()).toBe(1);
    expect(out()).toContain('https://23-138-76-150.nip.io');
  });

  it('re-asks the domain when DNS does not point here', async () => {
    const { prompt, out, left } = scripted([
      '3',
      '',
      'wrong.example.com',
      'n',
      'enso.example.com',
      'n',
    ]);
    const fake = fakeSystem({
      resolve4: async (host) => (host === 'enso.example.com' ? ['23.138.76.150'] : ['1.2.3.4']),
    });
    fake.sys.has = (cmd) => cmd === 'caddy' || cmd === 'systemctl';
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(out()).toContain('1.2.3.4');
    expect(saved().web?.publicUrl).toBe('https://enso.example.com');
  });

  it('prints a manual Caddy block when not root', async () => {
    const { prompt, out, left } = scripted(['3', '9000', 'enso.example.com', 'n']);
    const fake = fakeSystem({ root: false });
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(fake.execs).toEqual([]);
    expect(out()).toMatch(/enso\.example\.com \{\n\s+reverse_proxy 127\.0\.0\.1:9000\n\s+\}/);
    expect(saved().web).toMatchObject({ port: 9000, publicUrl: 'https://enso.example.com' });
  });

  it('configures an own reverse proxy and keeps the npm registry', async () => {
    writeServerConfig(dir, { npmRegistry: 'https://registry.example.com' });
    const { prompt, out, left } = scripted(['2', '', 'https://enso.example.com/', 'n']);
    const fake = fakeSystem();
    await runConfigWizard(prompt, fake.sys, { dataDir: dir });
    expect(left()).toBe(0);
    expect(saved()).toEqual({
      npmRegistry: 'https://registry.example.com',
      web: { enabled: true, host: '127.0.0.1', port: 7878, publicUrl: 'https://enso.example.com' },
    });
    expect(out()).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(readFileSync(path.join(dir, 'config.toml'), 'utf8')).toContain('[web]');
  });
});
