/**
 * 内置 web（手机 PWA + 中继协议）配置：默认关闭；开启后默认只听 127.0.0.1，TLS 由用户自己的反向代理负责。
 * 来源：环境变量 ENSO_WEB / ENSO_WEB_HOST / ENSO_WEB_PORT / ENSO_PUBLIC_URL，start 的同名参数优先；
 * 给出任一 web 参数即视为开启。
 */

export const DEFAULT_WEB_PORT = 7878;
const DEFAULT_WEB_HOST = '127.0.0.1';

export interface WebConfig {
  host: string;
  port: number;
  /** 宿主自己拨本机中继用，绕开反代 */
  localUrl: string;
  /** 手机访问的地址（反代后的 https），写进配对链接 */
  publicUrl: string;
}

export type WebConfigResult = { ok: true; web: WebConfig | null } | { ok: false; error: string };

const FLAGS = { '--web-host': 'host', '--web-port': 'port', '--public-url': 'publicUrl' } as const;

const truthy = (value: string | undefined): boolean =>
  /^(1|true|yes|on)$/i.test(value?.trim() ?? '');

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

function parsePublicUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // PWA 资源与 service worker 都按站点根路径注册，反代只能挂在根上
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname !== '/') return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

function dialHost(host: string): string {
  if (host === '0.0.0.0' || host === '') return '127.0.0.1';
  if (host === '::') return '[::1]';
  return host.includes(':') ? `[${host}]` : host;
}

export function parseWebConfig(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): WebConfigResult {
  let enabled = truthy(env.ENSO_WEB);
  const raw: Partial<Record<(typeof FLAGS)[keyof typeof FLAGS], string>> = {
    host: env.ENSO_WEB_HOST?.trim() || undefined,
    port: env.ENSO_WEB_PORT?.trim() || undefined,
    publicUrl: env.ENSO_PUBLIC_URL?.trim() || undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--web') {
      enabled = true;
      continue;
    }
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    if (!(flag in FLAGS)) return { ok: false, error: `未知参数: ${arg}` };
    const value = inline ?? argv[++i];
    if (!value) return { ok: false, error: `${flag} 缺少取值` };
    raw[FLAGS[flag as keyof typeof FLAGS]] = value;
  }
  // 给出任一 web 参数即视为开启，免得端口配了却静默不生效
  if (raw.host || raw.port || raw.publicUrl) enabled = true;
  if (!enabled) return { ok: true, web: null };

  const port = raw.port === undefined ? DEFAULT_WEB_PORT : parsePort(raw.port);
  if (port === null) return { ok: false, error: `端口无效: ${raw.port}` };
  const host = raw.host ?? DEFAULT_WEB_HOST;
  const localUrl = `http://${dialHost(host)}:${port}`;
  const publicUrl = raw.publicUrl === undefined ? localUrl : parsePublicUrl(raw.publicUrl);
  if (publicUrl === null) {
    return { ok: false, error: `公开地址须是不带路径的 http(s) 地址: ${raw.publicUrl}` };
  }
  return { ok: true, web: { host, port, localUrl, publicUrl } };
}
