import fs from 'node:fs';
import path from 'node:path';
import { npmPackumentUrl, unpackNpmTarball, verifyIntegrity } from '../llama/gpuBackend';

/** 与平台包同版本发布；wrapper 按相对路径 `../sherpa-onnx-<plat>-<arch>` 找原生插件 */
export const SHERPA_ONNX_VERSION = '1.13.8';
const WRAPPER_PACKAGE = 'sherpa-onnx-node';
const ADDON_FILE = 'sherpa-onnx.node';
const READY_MARKER = '.ready';

export function sherpaPlatformPackage(platform: string, arch: string): string | null {
  const os = platform === 'win32' ? 'win' : platform;
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win-x64'];
  const id = `${os}-${arch}`;
  return supported.includes(id) ? `sherpa-onnx-${id}` : null;
}

export function speechRuntimeDir(root: string, version: string): string {
  return path.join(root, `sherpa-onnx@${version}`);
}

export function speechRuntimeWrapperDir(dir: string): string {
  return path.join(dir, WRAPPER_PACKAGE);
}

export function isSpeechRuntimeReady(dir: string, platformPackage: string): boolean {
  return (
    fs.existsSync(path.join(dir, READY_MARKER)) &&
    fs.existsSync(path.join(dir, platformPackage, ADDON_FILE)) &&
    fs.existsSync(path.join(speechRuntimeWrapperDir(dir), 'package.json'))
  );
}

/** wrapper 与平台包解到同级目录，整体校验通过后才原子换入 dir */
export async function installSpeechRuntime(opts: {
  dir: string;
  platformPackage: string;
  version: string;
  registry?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  const registry = (
    opts.registry ??
    process.env.npm_config_registry ??
    'https://registry.npmjs.org'
  ).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  const tmp = `${opts.dir}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const name of [WRAPPER_PACKAGE, opts.platformPackage]) {
      const metaRes = await doFetch(`${npmPackumentUrl(registry, name)}/${opts.version}`, {
        signal: opts.signal,
      });
      if (!metaRes.ok) throw new Error(`${name} packument HTTP ${metaRes.status}`);
      const meta = (await metaRes.json()) as { dist?: { tarball?: string; integrity?: string } };
      const tarball = meta.dist?.tarball;
      const integrity = meta.dist?.integrity;
      if (!tarball || !integrity) throw new Error(`${name} packument missing dist`);
      const tarRes = await doFetch(tarball, { signal: opts.signal });
      if (!tarRes.ok) throw new Error(`${name} tarball HTTP ${tarRes.status}`);
      const body = Buffer.from(await tarRes.arrayBuffer());
      verifyIntegrity(body, integrity);
      unpackNpmTarball(body, path.join(tmp, name));
    }
    if (!fs.existsSync(path.join(tmp, opts.platformPackage, ADDON_FILE))) {
      throw new Error(`${opts.platformPackage} tarball missing ${ADDON_FILE}`);
    }
    fs.writeFileSync(path.join(tmp, READY_MARKER), new Date().toISOString());
    fs.rmSync(opts.dir, { recursive: true, force: true });
    fs.renameSync(tmp, opts.dir);
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}
