import type { DeskAsset } from './tunnel';

const FETCH_TIMEOUT_MS = 20_000;
const LINE = /^([0-9a-f]{64}) {2}(.+)$/;

/** 中继内置清单：逐行「sha256  相对路径」 */
export function parseBundleManifest(text: string): Map<string, string> | null {
  const files = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const match = LINE.exec(line);
    if (!match) return null;
    files.set(match[2] as string, match[1] as string);
  }
  return files.size > 0 ? files : null;
}

async function sha256Hex(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 中继内置的完整版界面：比经隧道从电脑上行拉快得多。中继不受信任——清单 sha256 须等于电脑经
 * 加密隧道报来的 id，文件再逐个按清单校验；任何不符或不可达都返回 null，由调用方改走隧道。
 */
export class RelayBundle {
  bytes = 0;
  private manifest: Promise<Map<string, string> | null> | null = null;

  constructor(
    private readonly base: string,
    private readonly id: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args)
  ) {}

  private async fetchBody(
    url: string
  ): Promise<{ body: Uint8Array<ArrayBuffer>; mime: string } | null> {
    try {
      const res = await this.fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const mime = res.headers.get('content-type') ?? 'application/octet-stream';
      return { body: new Uint8Array(await res.arrayBuffer()), mime };
    } catch {
      return null;
    }
  }

  private files(): Promise<Map<string, string> | null> {
    this.manifest ??= (async () => {
      const got = await this.fetchBody(`${this.base}/desk-bundle/${this.id}`);
      if (!got || (await sha256Hex(got.body)) !== this.id) return null;
      return parseBundleManifest(new TextDecoder().decode(got.body));
    })().catch(() => null);
    return this.manifest;
  }

  async get(path: string): Promise<DeskAsset | null> {
    const hash = (await this.files())?.get(path);
    if (!hash) return null;
    const url = `${this.base}/desk-bundle/${this.id}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const got = await this.fetchBody(url);
    if (!got || (await sha256Hex(got.body).catch(() => '')) !== hash) return null;
    this.bytes += got.body.byteLength;
    return { status: 200, mime: got.mime, body: got.body };
  }
}
