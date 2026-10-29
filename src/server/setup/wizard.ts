/** `enso-server config`：问答式选择手机的连接方式，写 config.toml，按需安装配置 Caddy */
import { DEFAULT_RELAY_URL } from '@enso/pair';
import { readServerConfig, type ServerConfig, writeServerConfig } from '../config';
import { DEFAULT_WEB_PORT } from '../web/config';
import {
  CADDYFILE,
  caddyBlock,
  foreignSite,
  hasCaddyBlock,
  isPublicIpv4,
  nipDomain,
  normalizeDomain,
  upsertCaddyBlock,
} from './caddy';

export interface Prompt {
  /** 空回答返回 fallback */
  ask(question: string, fallback?: string): Promise<string>;
  say(text: string): void;
}

export interface SetupSystem {
  linux: boolean;
  root: boolean;
  has(cmd: string): boolean;
  /** 执行命令，输出直通终端 */
  exec(cmd: string, args: string[]): boolean;
  readFile(file: string): string | null;
  writeFile(file: string, text: string): void;
  publicIp(): Promise<string | null>;
  resolve4(host: string): Promise<string[]>;
  /** GET 返回 2xx */
  probe(url: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  serviceInstalled(): boolean;
  serverRunning(): Promise<boolean>;
  /** 正在运行的服务实际用的中继地址；没在运行为 null */
  currentRelayUrl(): Promise<string | null>;
  /** systemd 单元里写死的 CONFIG_ENV_KEYS */
  serviceOverrides(): string[];
  installService(): Promise<void>;
  restartService(): boolean;
}

const Mode = { Relay: 0, OwnProxy: 1, Domain: 2, Nip: 3 } as const;
type Mode = (typeof Mode)[keyof typeof Mode];

const MODES = [
  '公共中继（默认）：不需要公网 IP 和域名，能直连时自动走 P2P',
  '内置 web，我自己配反向代理（nginx / Caddy / 隧道等，需支持 WebSocket）',
  '内置 web，我有域名：自动安装并配置 Caddy（自动申请 https 证书）',
  '内置 web，没有域名：用「公网IP.nip.io」+ Caddy（需要公网 IP，放行 80/443）',
];

const PACKAGE_MANAGERS: [string, string[][]][] = [
  ['apt-get', [['update'], ['install', '-y', 'caddy']]],
  ['dnf', [['install', '-y', 'caddy']]],
  ['yum', [['install', '-y', 'caddy']]],
  ['pacman', [['-S', '--noconfirm', 'caddy']]],
  ['zypper', [['--non-interactive', 'install', 'caddy']]],
  ['apk', [['add', 'caddy']]],
];

const indent = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');

async function choose(prompt: Prompt, question: string, options: string[], def: number) {
  prompt.say(question);
  for (const [i, option] of options.entries()) prompt.say(`  ${i + 1}) ${option}`);
  for (;;) {
    const n = Number(await prompt.ask('选择', String(def + 1)));
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    prompt.say(`请输入 1-${options.length}`);
  }
}

async function confirm(prompt: Prompt, question: string, def = true): Promise<boolean> {
  for (;;) {
    const answer = (await prompt.ask(`${question} ${def ? '[Y/n]' : '[y/N]'}`)).toLowerCase();
    if (!answer) return def;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
  }
}

async function askPort(prompt: Prompt, def: number): Promise<number> {
  for (;;) {
    const raw = await prompt.ask('内置 web 监听端口（只听 127.0.0.1）', String(def));
    const port = /^\d+$/.test(raw) ? Number(raw) : 0;
    if (port >= 1 && port <= 65535) return port;
    prompt.say('端口应为 1-65535');
  }
}

function originOf(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function askUrl(prompt: Prompt, question: string, def?: string): Promise<string> {
  for (;;) {
    const url = originOf(await prompt.ask(question, def));
    if (url) return url;
    prompt.say('应为不带路径的 http(s) 地址，例如 https://enso.example.com');
  }
}

async function askDomain(prompt: Prompt, sys: SetupSystem, def?: string): Promise<string> {
  for (;;) {
    const domain = normalizeDomain(await prompt.ask('域名（已解析到本机公网 IP）', def));
    if (!domain) {
      prompt.say('域名格式不对，例如 enso.example.com（不带端口）');
      continue;
    }
    const [ips, mine] = await Promise.all([
      sys.resolve4(domain).catch(() => [] as string[]),
      sys.publicIp(),
    ]);
    let warning = '';
    if (!ips.length) warning = `${domain} 还没有 A 记录，证书会申请失败`;
    else if (mine && !ips.includes(mine))
      warning = `${domain} 解析到 ${ips.join(', ')}，本机公网 IP 是 ${mine}`;
    if (!warning) return domain;
    prompt.say(warning);
    if (await confirm(prompt, '仍然使用这个域名？', false)) return domain;
  }
}

async function askNipDomain(prompt: Prompt, sys: SetupSystem): Promise<string> {
  const detected = await sys.publicIp();
  if (detected) prompt.say(`检测到本机公网 IP: ${detected}`);
  for (;;) {
    const ip = (await prompt.ask('本机公网 IPv4', detected ?? undefined)).trim();
    const domain = nipDomain(ip);
    if (domain && isPublicIpv4(ip)) return domain;
    prompt.say(
      domain
        ? `${ip} 是内网地址，手机和证书机构都访问不到；没有公网 IP 请选公共中继`
        : 'IPv4 格式不对'
    );
  }
}

function printProxyHints(prompt: Prompt, url: string, port: number): void {
  const host = new URL(url).host;
  prompt.say(`请让反向代理把 ${url} 转发到 http://127.0.0.1:${port}（需支持 WebSocket）。示例：`);
  prompt.say(`  Caddy:\n${indent(`${host} {\n\treverse_proxy 127.0.0.1:${port}\n}`)}`);
  prompt.say(
    `  nginx（server 块内）:\n${indent(`location / {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 1h;
}`)}`
  );
}

function installCaddy(sys: SetupSystem): boolean {
  const found = PACKAGE_MANAGERS.find(([cmd]) => sys.has(cmd));
  if (!found) return false;
  const [cmd, steps] = found;
  for (const args of steps) {
    // apt-get update 失败（某个源不通）不一定影响安装
    if (!sys.exec(cmd, args) && args[0] !== 'update') return false;
  }
  return sys.has('caddy');
}

/** 返回是否已自动配置好 */
async function setupCaddy(
  prompt: Prompt,
  sys: SetupSystem,
  domain: string,
  port: number
): Promise<boolean> {
  const manual = (reason: string) => {
    prompt.say(`${reason}，请手动配置 Caddy（安装见 https://caddyserver.com/docs/install）：`);
    prompt.say(indent(`${domain} {\n\treverse_proxy 127.0.0.1:${port}\n}`));
    prompt.say(`写入 ${CADDYFILE} 后执行 systemctl reload caddy；并放行 80/443 端口`);
    return false;
  };
  if (!sys.linux) return manual('自动配置 Caddy 只支持 Linux');
  if (!sys.root) return manual('安装 / 配置 Caddy 需要 root');
  if (!sys.has('caddy')) {
    if (!(await confirm(prompt, '没有检测到 Caddy，现在安装？'))) return manual('已跳过安装');
    if (!installCaddy(sys)) return manual('自动安装 Caddy 失败');
  }
  const before = sys.readFile(CADDYFILE);
  const existing = foreignSite(before, domain, port);
  if (existing?.proxiesHere) {
    prompt.say(`${CADDYFILE} 里已有 ${domain} → 127.0.0.1:${port} 的站点，沿用不改`);
    return true;
  }
  if (existing) {
    prompt.say(
      `${CADDYFILE} 里已有 ${domain} 站点（不是本向导写的），请把它改成 reverse_proxy 127.0.0.1:${port} 后 systemctl reload caddy`
    );
    return false;
  }
  if (before !== null) sys.writeFile(`${CADDYFILE}.enso-bak`, before);
  sys.writeFile(CADDYFILE, upsertCaddyBlock(before, domain, port));
  if (!sys.exec('caddy', ['validate', '--config', CADDYFILE, '--adapter', 'caddyfile'])) {
    if (before !== null) sys.writeFile(CADDYFILE, before);
    return manual(`${CADDYFILE} 校验失败，已还原`);
  }
  if (
    !sys.exec('systemctl', ['enable', 'caddy']) ||
    !sys.exec('systemctl', ['reload-or-restart', 'caddy'])
  ) {
    prompt.say(
      '启动 Caddy 失败：检查 80/443 是否被其他程序占用（ss -ltnp），journalctl -u caddy 看日志'
    );
    return false;
  }
  prompt.say(`Caddy 已配置: https://${domain} → 127.0.0.1:${port}（备份 ${CADDYFILE}.enso-bak）`);
  return true;
}

/** 返回新配置是否已在运行 */
async function applyToServer(prompt: Prompt, sys: SetupSystem): Promise<boolean> {
  if (sys.serviceInstalled()) {
    const pinned = sys.serviceOverrides();
    if (pinned.length) {
      prompt.say(`服务单元里写死了 ${pinned.join(', ')}（旧版本写入），会盖过配置文件`);
      if (await confirm(prompt, '重新注册服务（去掉这些）并重启？')) {
        await sys.installService();
        return true;
      }
      prompt.say('稍后执行 enso-server service install 重新注册');
      return false;
    }
    if (!(await confirm(prompt, '重启 enso-server 服务使配置生效？'))) {
      prompt.say('稍后执行 systemctl restart enso-server 生效');
      return false;
    }
    if (sys.restartService()) return true;
    prompt.say('重启失败，查看 enso-server logs');
    return false;
  }
  if (await sys.serverRunning()) {
    prompt.say('enso-server 正在前台运行：Ctrl+C 停掉后重新 `enso-server start` 生效');
    return false;
  }
  if (sys.linux && (await confirm(prompt, '注册为 systemd 服务（开机自启、崩溃拉起）？'))) {
    await sys.installService();
    return true;
  }
  prompt.say('运行 `enso-server start` 启动');
  return false;
}

async function waitFor(sys: SetupSystem, url: string, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await sys.probe(url)) return true;
    await sys.sleep(3_000);
  }
  return false;
}

function defaultMode(config: ServerConfig, sys: SetupSystem): Mode {
  if (!config.web?.enabled) return Mode.Relay;
  const host = config.web.publicUrl ? new URL(config.web.publicUrl).hostname : '';
  if (host.endsWith('.nip.io')) return Mode.Nip;
  const caddy = sys.readFile(CADDYFILE) ?? '';
  return host && caddy.includes(caddyBlock(host, config.web.port ?? DEFAULT_WEB_PORT))
    ? Mode.Domain
    : Mode.OwnProxy;
}

const effectiveUrl = (config: ServerConfig) =>
  config.web?.enabled ? config.web.publicUrl : (config.relayUrl ?? DEFAULT_RELAY_URL);

export async function runConfigWizard(
  prompt: Prompt,
  sys: SetupSystem,
  ctx: { dataDir: string }
): Promise<ServerConfig> {
  const current = readServerConfig(ctx.dataDir);
  if (!current.ok) prompt.say(`现有配置无法解析，将重写: ${current.error}`);
  const prev = current.ok ? current.config : {};
  const next: ServerConfig = prev.npmRegistry ? { npmRegistry: prev.npmRegistry } : {};
  const prevUrl = prev.web?.publicUrl ? new URL(prev.web.publicUrl).hostname : undefined;

  const runningUrl = await sys.currentRelayUrl();
  const mode = await choose(prompt, '手机怎么连到这台服务器？', MODES, defaultMode(prev, sys));
  let caddyReady = false;
  if (mode === Mode.Relay) {
    const relay = await askUrl(prompt, '中继地址', prev.relayUrl ?? DEFAULT_RELAY_URL);
    if (relay !== DEFAULT_RELAY_URL) next.relayUrl = relay;
  } else {
    const port = await askPort(prompt, prev.web?.port ?? DEFAULT_WEB_PORT);
    let publicUrl: string;
    if (mode === Mode.OwnProxy) {
      publicUrl = await askUrl(
        prompt,
        '手机访问的地址（反代后的 https 根地址）',
        prev.web?.publicUrl
      );
      if (publicUrl.startsWith('http:'))
        prompt.say('注意：http 地址下手机端无法配对和使用完整版，正式使用请配 https');
      printProxyHints(prompt, publicUrl, port);
    } else {
      const domain =
        mode === Mode.Domain
          ? await askDomain(prompt, sys, prevUrl?.endsWith('.nip.io') ? undefined : prevUrl)
          : await askNipDomain(prompt, sys);
      publicUrl = `https://${domain}`;
      caddyReady = await setupCaddy(prompt, sys, domain, port);
    }
    next.web = { enabled: true, host: '127.0.0.1', port, publicUrl };
  }

  prompt.say(`已保存 ${writeServerConfig(ctx.dataDir, next)}`);
  if (
    (mode === Mode.Relay || mode === Mode.OwnProxy) &&
    sys.linux &&
    hasCaddyBlock(sys.readFile(CADDYFILE))
  )
    prompt.say(
      `${CADDYFILE} 里还有之前配的 enso-server 段，不再需要可删掉后 systemctl reload caddy`
    );
  const running = await applyToServer(prompt, sys);
  const web = next.web;
  if (running && web?.publicUrl && web.port) {
    if (!(await waitFor(sys, `http://127.0.0.1:${web.port}/healthz`, 10))) {
      prompt.say('内置 web 没有起来，查看 enso-server logs');
    } else if (mode === Mode.OwnProxy || caddyReady) {
      prompt.say(`检查 ${web.publicUrl} …（首次申请证书可能要几十秒）`);
      if (await waitFor(sys, `${web.publicUrl}/healthz`, 20))
        prompt.say(`✓ ${web.publicUrl} 可以访问`);
      else
        prompt.say(
          mode === Mode.OwnProxy
            ? '内置 web 正常，但公开地址访问不到：检查反向代理与 WebSocket 转发'
            : '公开地址访问不到：检查域名解析、云服务器安全组 / 防火墙是否放行 80/443，journalctl -u caddy 看日志'
        );
    }
  }
  if ((runningUrl ?? effectiveUrl(prev)) !== effectiveUrl(next))
    prompt.say('连接地址变了：已配对的设备需要重新配对');
  prompt.say('下一步: enso-server pair');
  return next;
}
