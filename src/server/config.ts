/**
 * $ENSO_DATA_DIR/config.toml：持久化 ENSO_* 设置（`enso-server config` 生成，也可手改）。
 * 优先级：命令行参数 > 环境变量 > 本文件。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

export const CONFIG_FILE = 'config.toml';

export interface WebSettings {
  enabled: boolean;
  host?: string;
  port?: number;
  publicUrl?: string;
}

export interface ServerConfig {
  relayUrl?: string;
  npmRegistry?: string;
  web?: WebSettings;
}

export type ConfigResult = { ok: true; config: ServerConfig } | { ok: false; error: string };

const TOP = { relay_url: 'relayUrl', npm_registry: 'npmRegistry' } as const;
const WEB_STRINGS = { host: 'host', public_url: 'publicUrl' } as const;

export function parseServerConfig(text: string): ConfigResult {
  let raw: Record<string, unknown>;
  try {
    raw = parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `语法错误: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const config: ServerConfig = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'web') {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return { ok: false, error: 'web 应为表 [web]' };
      const web: WebSettings = { enabled: true };
      for (const [k, v] of Object.entries(value)) {
        if (k === 'enabled') {
          if (typeof v !== 'boolean') return { ok: false, error: 'web.enabled 应为 true / false' };
          web.enabled = v;
        } else if (k === 'port') {
          if (typeof v !== 'number' || !Number.isInteger(v))
            return { ok: false, error: 'web.port 应为整数' };
          web.port = v;
        } else if (k in WEB_STRINGS) {
          if (typeof v !== 'string') return { ok: false, error: `web.${k} 应为字符串` };
          web[WEB_STRINGS[k as keyof typeof WEB_STRINGS]] = v;
        } else return { ok: false, error: `未知配置项: web.${k}` };
      }
      config.web = web;
    } else if (key in TOP) {
      if (typeof value !== 'string') return { ok: false, error: `${key} 应为字符串` };
      config[TOP[key as keyof typeof TOP]] = value;
    } else return { ok: false, error: `未知配置项: ${key}` };
  }
  return { ok: true, config };
}

export function readServerConfig(dataDir: string): ConfigResult {
  const file = path.join(dataDir, CONFIG_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { ok: true, config: {} };
  }
  const result = parseServerConfig(text);
  return result.ok ? result : { ok: false, error: `${file}: ${result.error}` };
}

const str = (value: string) => JSON.stringify(value);

export function serializeServerConfig(config: ServerConfig): string {
  const lines = [
    '# enso-server 配置（`enso-server config` 生成，可手改，改完重启服务生效）',
    '# 优先级：命令行参数 > 环境变量 > 本文件',
    '',
  ];
  if (config.relayUrl) lines.push(`relay_url = ${str(config.relayUrl)}`);
  if (config.npmRegistry) lines.push(`npm_registry = ${str(config.npmRegistry)}`);
  const web = config.web;
  if (web) {
    if (lines.length > 3) lines.push('');
    lines.push('# 内置 web：手机直接访问本机，不经公共中继', '[web]', `enabled = ${web.enabled}`);
    if (web.host) lines.push(`host = ${str(web.host)}`);
    if (web.port !== undefined) lines.push(`port = ${web.port}`);
    if (web.publicUrl) lines.push(`public_url = ${str(web.publicUrl)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** 原子写入，0600；返回文件路径 */
export function writeServerConfig(dataDir: string, config: ServerConfig): string {
  const file = path.join(dataDir, CONFIG_FILE);
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, serializeServerConfig(config), { mode: 0o600 });
  renameSync(tmp, file);
  return file;
}

/** 配置文件管辖的环境变量；写死在 systemd 单元里会盖过配置文件 */
export const CONFIG_ENV_KEYS = [
  'ENSO_RELAY_URL',
  'ENSO_NPM_REGISTRY',
  'ENSO_WEB',
  'ENSO_WEB_HOST',
  'ENSO_WEB_PORT',
  'ENSO_PUBLIC_URL',
] as const;

export function configEnv(config: ServerConfig): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.relayUrl) env.ENSO_RELAY_URL = config.relayUrl;
  if (config.npmRegistry) env.ENSO_NPM_REGISTRY = config.npmRegistry;
  const web = config.web;
  if (web?.enabled) {
    env.ENSO_WEB = '1';
    if (web.host) env.ENSO_WEB_HOST = web.host;
    if (web.port !== undefined) env.ENSO_WEB_PORT = String(web.port);
    if (web.publicUrl) env.ENSO_PUBLIC_URL = web.publicUrl;
  }
  return env;
}

/** 只补环境里没设（或为空）的键，保证环境变量优先 */
export function applyConfigEnv(
  env: Record<string, string | undefined>,
  config: ServerConfig
): void {
  for (const [key, value] of Object.entries(configEnv(config))) {
    if (!env[key]?.trim()) env[key] = value;
  }
}
