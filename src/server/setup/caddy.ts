export const CADDYFILE = '/etc/caddy/Caddyfile';

const BEGIN = '# >>> enso-server（`enso-server config` 管理，重新配置会覆盖此段）';
const END = '# <<< enso-server';

export function caddyBlock(domain: string, port: number): string {
  return `${BEGIN}\n${domain} {\n\treverse_proxy 127.0.0.1:${port}\n}\n${END}\n`;
}

/** 发行版包自带的示例 Caddyfile（:80 静态站），占着 80 端口，直接替换 */
function isPackageDefault(text: string): boolean {
  const body = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
  return /^:80\s*\{[^{}]*\/usr\/share\/caddy[^{}]*\}$/.test(body);
}

const MARK = BEGIN.slice(0, BEGIN.indexOf('（'));

export const hasCaddyBlock = (text: string | null): boolean => Boolean(text?.includes(MARK));

function withoutBlock(text: string): string {
  const start = text.indexOf(MARK);
  const end = text.indexOf(END);
  if (start === -1 || end < start) return text;
  return text.slice(0, start) + text.slice(end + END.length).replace(/^\n/, '');
}

/** 写入（或替换）自己的标记段，保留用户的其他站点 */
export function upsertCaddyBlock(existing: string | null, domain: string, port: number): string {
  const block = caddyBlock(domain, port);
  if (!existing?.trim() || isPackageDefault(existing)) return block;
  const rest = withoutBlock(existing).replace(/\n+$/, '\n');
  return rest.trim() ? `${rest}\n${block}` : block;
}

const siteHost = (address: string) =>
  address
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/:\d+$/, '');

/**
 * 标记段之外（用户手写的）同域名站点；再写一份 Caddy 会报 ambiguous site definition。
 * 只认顶层 `地址[, 地址] {` 形式，全局选项块和 `(snippet)` 不算。
 */
export function foreignSite(
  text: string | null,
  domain: string,
  port: number
): { proxiesHere: boolean } | null {
  if (!text) return null;
  const proxy = new RegExp(
    `\\breverse_proxy\\s+(?:https?://)?(?:127\\.0\\.0\\.1|localhost):${port}(?!\\d)`
  );
  let depth = 0;
  let site: { match: boolean; body: string[] } | null = null;
  for (const raw of withoutBlock(text).split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '');
    if (depth === 0) {
      const head = /^\s*([^{}\s(][^{}]*?)\s*\{\s*$/.exec(line);
      if (head) {
        const hosts = head[1]
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(siteHost);
        site = { match: hosts.includes(domain), body: [] };
      }
    } else site?.body.push(line);
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    if (depth <= 0) {
      depth = 0;
      if (site?.match) return { proxiesHere: proxy.test(site.body.join('\n')) };
      site = null;
    }
  }
  return null;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function octets(ip: string): number[] | null {
  const m = IPV4.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

export function isPublicIpv4(ip: string): boolean {
  const o = octets(ip);
  if (!o) return false;
  const [a, b] = o;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** 23.138.76.150 → 23-138-76-150.nip.io（解析回该 IP，Caddy 可直接签证书） */
export function nipDomain(ip: string): string | null {
  const o = octets(ip);
  return o ? `${o.join('-')}.nip.io` : null;
}

/** 用户输入的域名：去掉协议与路径；不接受端口（Caddy 自动 https 要走 80/443） */
export function normalizeDomain(raw: string): string | null {
  let host = raw.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^[a-z]+:\/\//, '').split('/')[0] ?? '';
  const label = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => label.test(l))) return null;
  return host;
}
