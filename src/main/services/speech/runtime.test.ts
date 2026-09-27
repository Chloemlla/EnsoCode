import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installSpeechRuntime,
  isSpeechRuntimeReady,
  sherpaPlatformPackage,
  speechRuntimeDir,
} from './runtime';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'enso-speech-runtime-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sherpaPlatformPackage', () => {
  it('maps supported platforms to the npm package that ships the native addon', () => {
    expect(sherpaPlatformPackage('darwin', 'arm64')).toBe('sherpa-onnx-darwin-arm64');
    expect(sherpaPlatformPackage('darwin', 'x64')).toBe('sherpa-onnx-darwin-x64');
    expect(sherpaPlatformPackage('linux', 'x64')).toBe('sherpa-onnx-linux-x64');
    expect(sherpaPlatformPackage('linux', 'arm64')).toBe('sherpa-onnx-linux-arm64');
    expect(sherpaPlatformPackage('win32', 'x64')).toBe('sherpa-onnx-win-x64');
  });

  it('returns null where no prebuilt addon exists', () => {
    expect(sherpaPlatformPackage('win32', 'arm64')).toBeNull();
    expect(sherpaPlatformPackage('freebsd', 'x64')).toBeNull();
  });
});

describe('installSpeechRuntime', () => {
  const wrapper = makeTgz({
    'package/package.json': '{"name":"sherpa-onnx-node","version":"1.13.8"}',
    'package/sherpa-onnx.js': 'module.exports = {};',
  });
  const addon = makeTgz({
    'package/package.json': '{"name":"sherpa-onnx-darwin-arm64","version":"1.13.8"}',
    'package/sherpa-onnx.node': 'addon',
  });

  function registry(tarballs: Record<string, Buffer>, requested: string[] = []): typeof fetch {
    return async (input) => {
      const url = String(input);
      requested.push(url);
      for (const [name, tgz] of Object.entries(tarballs)) {
        if (url === `https://registry.test/${name}/1.13.8`) {
          const integrity = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
          return Response.json({
            dist: { tarball: `https://registry.test/${name}.tgz`, integrity },
          });
        }
        if (url === `https://registry.test/${name}.tgz`) {
          return new Response(Uint8Array.from(tgz), { status: 200 });
        }
      }
      return new Response('missing', { status: 404 });
    };
  }

  it('puts the wrapper and the addon side by side so the wrapper finds the addon', async () => {
    const dir = speechRuntimeDir(root, '1.13.8');
    await installSpeechRuntime({
      dir,
      platformPackage: 'sherpa-onnx-darwin-arm64',
      version: '1.13.8',
      registry: 'https://registry.test/',
      fetch: registry({ 'sherpa-onnx-node': wrapper, 'sherpa-onnx-darwin-arm64': addon }),
    });
    expect(isSpeechRuntimeReady(dir, 'sherpa-onnx-darwin-arm64')).toBe(true);
    expect(
      readFileSync(path.join(dir, 'sherpa-onnx-darwin-arm64', 'sherpa-onnx.node'), 'utf8')
    ).toBe('addon');
    expect(existsSync(path.join(dir, 'sherpa-onnx-node', 'sherpa-onnx.js'))).toBe(true);
  });

  it('leaves nothing usable behind when a tarball fails its integrity check', async () => {
    const dir = speechRuntimeDir(root, '1.13.8');
    const tampered: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/1.13.8')) {
        return Response.json({
          dist: { tarball: `${url}.tgz`, integrity: 'sha512-AAAA' },
        });
      }
      return new Response(Uint8Array.from(wrapper), { status: 200 });
    };
    await expect(
      installSpeechRuntime({
        dir,
        platformPackage: 'sherpa-onnx-darwin-arm64',
        version: '1.13.8',
        registry: 'https://registry.test',
        fetch: tampered,
      })
    ).rejects.toThrow(/integrity/);
    expect(isSpeechRuntimeReady(dir, 'sherpa-onnx-darwin-arm64')).toBe(false);
    expect(existsSync(`${dir}.tmp`)).toBe(false);
  });

  it('rejects a platform package that carries no native addon', async () => {
    const dir = speechRuntimeDir(root, '1.13.8');
    const empty = makeTgz({ 'package/package.json': '{}' });
    await expect(
      installSpeechRuntime({
        dir,
        platformPackage: 'sherpa-onnx-darwin-arm64',
        version: '1.13.8',
        registry: 'https://registry.test',
        fetch: registry({ 'sherpa-onnx-node': wrapper, 'sherpa-onnx-darwin-arm64': empty }),
      })
    ).rejects.toThrow(/sherpa-onnx.node/);
    expect(isSpeechRuntimeReady(dir, 'sherpa-onnx-darwin-arm64')).toBe(false);
  });
});

function makeTgz(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(`${data.length.toString(8).padStart(11, '0')} `, 124, 12, 'utf8');
    header.write('0', 156, 1, 'utf8');
    header.write('ustar\0', 257, 6, 'utf8');
    header.write('00', 263, 2, 'utf8');
    header.fill(0x20, 148, 156);
    let checksum = 0;
    for (const b of header) checksum += b;
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
