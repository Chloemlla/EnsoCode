import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildRemoteCommand,
  buildSshExecArgs,
  type SshExecArgsOptions,
  shellQuote,
} from '@shared/ssh';
import type { SshHostKeyChallenge } from '@shared/types';
import { sshPasswordEnv } from '../../agent/ssh/executor';
import { readSshTimeoutSeconds } from '../ipc/settings';
import { challengeFromScan, classifySshHostKeyFailure, scanSshHostKey } from './sshHostKey';

const CONNECT_TIMEOUT_SECONDS = 10;

export function buildSshProbeArgs(
  host: string,
  remotePath: string,
  options: SshExecArgsOptions = {}
): string[] {
  return buildSshExecArgs(host, buildRemoteCommand(['test', '-d', remotePath]), {
    connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
    ...options,
  });
}

export function buildSshLoginProbeArgs(host: string, options: SshExecArgsOptions = {}): string[] {
  return buildSshExecArgs(host, buildRemoteCommand(['true']), {
    connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
    ...options,
  });
}

export type SshProbeError = { error: string; hostKey?: SshHostKeyChallenge };
export type SshProbeOptions = SshExecArgsOptions & {
  password?: string;
  keyscanHost?: string;
};

export function classifySshProbeFailure(
  code: number,
  stderr: string,
  auth: SshExecArgsOptions['auth'] = 'key'
): string {
  if (code === 255) {
    const hostKey = classifySshHostKeyFailure(stderr);
    if (hostKey === 'changed') return 'SSH 主机密钥已变更:请核对 known_hosts 后再连接。';
    if (hostKey === 'untrusted') return 'SSH 主机密钥未信任。';
    if (/posix_spawnp|CreateProcessW failed|ssh_askpass/i.test(stderr)) {
      return 'SSH 认证失败:无法调用密码助手。';
    }
    if (/permission denied|authentication/i.test(stderr)) {
      return auth === 'password'
        ? 'SSH 认证失败:用户名或密码不正确。'
        : 'SSH 认证失败:请确认已配置密钥登录。';
    }
    return `无法连接到远程主机:${stderr.trim() || '连接失败'}`;
  }
  return '远程路径不存在或不是目录。';
}

async function attachHostKey(
  error: string,
  stderr: string,
  options: SshProbeOptions
): Promise<SshProbeError> {
  if (classifySshHostKeyFailure(stderr) !== 'untrusted' || !options.keyscanHost) {
    return { error };
  }
  const scanned = await scanSshHostKey(options.keyscanHost, options.port ?? 22);
  return {
    error,
    hostKey: challengeFromScan(options.keyscanHost, options.port ?? 22, scanned),
  };
}

function probeEnv(password?: string): NodeJS.ProcessEnv | undefined {
  if (!password) return undefined;
  return sshPasswordEnv(path.join(tmpdir(), 'enso-ssh-askpass'), password);
}

function runSshProbe(
  args: string[],
  options: SshProbeOptions,
  onOtherCode: string
): Promise<SshProbeError | null> {
  return new Promise((resolve) => {
    execFile(
      'ssh',
      args,
      { timeout: readSshTimeoutSeconds() * 1000, env: probeEnv(options.password) ?? process.env },
      (error, _stdout, stderr) => {
        if (!error) return resolve(null);
        const code =
          typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code?: number }).code as number)
            : 255;
        if ((error as { killed?: boolean }).killed) {
          return resolve({ error: '连接远程主机超时。' });
        }
        const message =
          code === 255 ? classifySshProbeFailure(code, stderr ?? '', options.auth) : onOtherCode;
        void attachHostKey(message, stderr ?? '', options).then(resolve);
      }
    );
  });
}

export function sshProbeDirectory(
  host: string,
  remotePath: string,
  options: SshProbeOptions = {}
): Promise<SshProbeError | null> {
  return runSshProbe(
    buildSshProbeArgs(host, remotePath, options),
    options,
    '远程路径不存在或不是目录。'
  );
}

/** 列远程子目录脚本：首行 pwd 解析真实绝对路径（支持 ~ 起点），隐藏目录不列 */
export function buildSshListDirsScript(path?: string): string {
  const target = path ? shellQuote(path) : '~';
  return `cd ${target} && pwd && find . -mindepth 1 -maxdepth 1 -type d ! -name '.*'`;
}

/** 解析列目录输出；首行非绝对路径视为异常返回 null */
export function parseSshListDirsOutput(stdout: string): { path: string; dirs: string[] } | null {
  const lines = stdout.split('\n');
  const path = lines[0]?.trim();
  if (!path?.startsWith('/')) return null;
  const dirs = lines
    .slice(1)
    .filter((line) => line.startsWith('./'))
    .map((line) => line.slice(2))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return { path, dirs };
}

export function sshListRemoteDirs(
  host: string,
  path: string | undefined,
  options: SshProbeOptions = {}
): Promise<
  | { ok: true; path: string; dirs: string[] }
  | { ok: false; error: string; hostKey?: SshHostKeyChallenge }
> {
  const args = buildSshExecArgs(host, buildRemoteCommand(buildSshListDirsScript(path)), {
    connectTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
    ...options,
  });
  return new Promise((resolve) => {
    execFile(
      'ssh',
      args,
      { timeout: readSshTimeoutSeconds() * 1000, env: probeEnv(options.password) ?? process.env },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as { killed?: boolean }).killed) {
            return resolve({ ok: false, error: '连接远程主机超时。' });
          }
          const code =
            typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code?: number }).code as number)
              : 255;
          const message =
            code === 255
              ? classifySshProbeFailure(code, stderr ?? '', options.auth)
              : '远程路径不存在或不是目录。';
          void attachHostKey(message, stderr ?? '', options).then((failure) =>
            resolve({ ok: false, ...failure })
          );
          return;
        }
        const parsed = parseSshListDirsOutput(stdout ?? '');
        resolve(parsed ? { ok: true, ...parsed } : { ok: false, error: '远程命令输出异常。' });
      }
    );
  });
}

export function sshProbeLogin(
  host: string,
  options: SshProbeOptions = {}
): Promise<SshProbeError | null> {
  return runSshProbe(buildSshLoginProbeArgs(host, options), options, '远程命令执行失败。');
}
