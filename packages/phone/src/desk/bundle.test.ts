import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseBundleManifest, RelayBundle } from './bundle';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function relay(files: Record<string, string>, tamper: Record<string, string> = {}) {
  const manifest = Object.keys(files)
    .sort()
    .map((p) => `${sha(files[p] ?? '')}  ${p}\n`)
    .join('');
  const id = sha(manifest);
  const requests: string[] = [];
  const fetcher = async (url: string) => {
    requests.push(url);
    const rest = url.slice('https://relay.test/desk-bundle/'.length);
    if (rest === id) return new Response(tamper.manifest ?? manifest);
    const path = decodeURIComponent(rest.slice(id.length + 1));
    const body = tamper[path] ?? files[path];
    return body === undefined
      ? new Response('nope', { status: 404 })
      : new Response(body, { headers: { 'Content-Type': 'text/javascript' } });
  };
  return { id, requests, fetcher: fetcher as typeof fetch };
}

const text = (body: Uint8Array | undefined) => new TextDecoder().decode(body);

describe('relay bundle', () => {
  it('parses the manifest and rejects malformed lines', () => {
    expect(parseBundleManifest(`${sha('a')}  assets/a.js\n`)?.get('assets/a.js')).toBe(sha('a'));
    expect(parseBundleManifest('<html>phone</html>')).toBeNull();
    expect(parseBundleManifest('')).toBeNull();
  });

  it('serves verified files from the relay and counts bytes', async () => {
    const r = relay({ 'assets/a.js': 'export {}', 'web-preload.js': 'void 0' });
    const bundle = new RelayBundle('https://relay.test', r.id, r.fetcher);
    const asset = await bundle.get('assets/a.js');
    expect(asset?.status).toBe(200);
    expect(asset?.mime).toBe('text/javascript');
    expect(text(asset?.body)).toBe('export {}');
    expect(text((await bundle.get('web-preload.js'))?.body)).toBe('void 0');
    expect(bundle.bytes).toBe(15);
    expect(r.requests.filter((u) => u.endsWith(r.id))).toHaveLength(1);
  });

  it('falls back (null) for files that fail verification or are not listed', async () => {
    const r = relay({ 'assets/a.js': 'export {}' }, { 'assets/a.js': 'alert(1)' });
    const bundle = new RelayBundle('https://relay.test', r.id, r.fetcher);
    expect(await bundle.get('assets/a.js')).toBeNull();
    expect(await bundle.get('index.html')).toBeNull();
    expect(bundle.bytes).toBe(0);
  });

  it('ignores the whole relay when its manifest does not match the desktop id', async () => {
    const r = relay(
      { 'assets/a.js': 'export {}' },
      { manifest: `${sha('alert(1)')}  assets/a.js\n` }
    );
    const bundle = new RelayBundle('https://relay.test', r.id, r.fetcher);
    expect(await bundle.get('assets/a.js')).toBeNull();
    expect(r.requests).toHaveLength(1);
  });

  it('falls back when the relay is unreachable', async () => {
    const bundle = new RelayBundle('https://relay.test', sha('x'), (async () => {
      throw new TypeError('offline');
    }) as typeof fetch);
    expect(await bundle.get('assets/a.js')).toBeNull();
  });
});
