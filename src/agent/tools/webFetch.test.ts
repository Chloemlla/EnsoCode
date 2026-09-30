import { describe, expect, it, vi } from 'vitest';
import { formatFetchResult, isPublicAddress, validateFetchUrl, webFetch } from './webFetch';

const publicLookup = async () => ['93.184.215.14'];

function respond(body: BodyInit | null, init: ResponseInit & { url?: string } = {}) {
  return new Response(body, init);
}

describe('validateFetchUrl', () => {
  it('只接受无凭据、长度受限的 http(s) URL', () => {
    expect(validateFetchUrl('https://example.com/a').href).toBe('https://example.com/a');
    expect(() => validateFetchUrl('ftp://example.com')).toThrow(/http/);
    expect(() => validateFetchUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => validateFetchUrl('https://user:pw@example.com')).toThrow(/credentials/);
    expect(() => validateFetchUrl('not a url')).toThrow(/Invalid URL/);
    expect(() => validateFetchUrl(`https://example.com/${'a'.repeat(2100)}`)).toThrow(/length/);
  });
});

describe('isPublicAddress', () => {
  it.each([
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['fe80::1', false],
    ['fd00::1', false],
    ['::ffff:127.0.0.1', false],
    ['8.8.8.8', true],
    // Surge / Clash 的 fake-ip 段：代理环境下公网域名都解析到这里
    ['198.18.0.5', true],
    ['2606:4700::1111', true],
  ])('%s → %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe('webFetch', () => {
  it('域名解析到内网地址时拒绝，且不发请求', async () => {
    const fetch = vi.fn();
    await expect(
      webFetch('https://intranet.example/', {}, { fetch, lookup: async () => ['10.0.0.8'] })
    ).rejects.toThrow(/non-public/);
    await expect(webFetch('http://localhost:3000/', {}, { fetch })).rejects.toThrow(/non-public/);
    await expect(webFetch('http://[::1]/', {}, { fetch })).rejects.toThrow(/non-public/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('跟随重定向并逐跳复检，重定向到内网即拒绝', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respond(null, { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(
        respond('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
      );
    const result = await webFetch('https://a.example/start', {}, { fetch, lookup: publicLookup });
    expect(result.url).toBe('https://a.example/next');
    expect(result.text).toBe('ok');

    const evil = vi
      .fn()
      .mockResolvedValue(
        respond(null, { status: 301, headers: { location: 'http://127.0.0.1/admin' } })
      );
    await expect(
      webFetch('https://a.example/', {}, { fetch: evil, lookup: publicLookup })
    ).rejects.toThrow(/non-public/);
    expect(evil).toHaveBeenCalledTimes(1);
  });

  it('重定向次数有上限', async () => {
    const fetch = vi.fn(async () => respond(null, { status: 302, headers: { location: '/loop' } }));
    await expect(
      webFetch('https://a.example/', {}, { fetch, lookup: publicLookup })
    ).rejects.toThrow(/redirects/);
  });

  it('HTML 提取正文转 markdown，丢掉脚本与导航', async () => {
    const paragraph = 'Readable body text that matters. '.repeat(20);
    const html = `<!doctype html><html><head><title>Doc Title</title><script>var secret=1</script></head>
      <body><nav><a href="/x">Menu</a></nav><article><h1>Heading</h1><p>${paragraph}</p>
      <p>See <a href="/docs">docs</a>.</p></article></body></html>`;
    const fetch = vi.fn(async () =>
      respond(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    );
    const result = await webFetch('https://a.example/page', {}, { fetch, lookup: publicLookup });
    expect(result.title).toBe('Doc Title');
    expect(result.text).toContain('Readable body text');
    expect(result.text).toContain('[docs](https://a.example/docs)');
    expect(result.text).not.toContain('secret');
  });

  it('JSON 原样返回，二进制拒绝', async () => {
    const json = vi.fn(async () =>
      respond('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    expect(
      (await webFetch('https://a.example/x', {}, { fetch: json, lookup: publicLookup })).text
    ).toBe('{"a":1}');
    const png = vi.fn(async () =>
      respond(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
    );
    await expect(
      webFetch('https://a.example/x.png', {}, { fetch: png, lookup: publicLookup })
    ).rejects.toThrow(/Unsupported content type: image\/png/);
  });

  it('按声明或 meta 的 charset 解码', async () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // “你好”
    const fetch = vi.fn(async () =>
      respond(gbk, { status: 200, headers: { 'content-type': 'text/plain; charset=gbk' } })
    );
    expect((await webFetch('https://a.example/', {}, { fetch, lookup: publicLookup })).text).toBe(
      '你好'
    );
    const html = new Uint8Array([
      ...new TextEncoder().encode('<html><head><meta charset="gbk"><title>'),
      ...gbk,
      ...new TextEncoder().encode('</title></head><body><p>x</p></body></html>'),
    ]);
    const meta = vi.fn(async () =>
      respond(html, { status: 200, headers: { 'content-type': 'text/html' } })
    );
    expect(
      (await webFetch('https://a.example/', {}, { fetch: meta, lookup: publicLookup })).title
    ).toBe('你好');
  });

  it('长文按 offset 分页并标记截断', async () => {
    const body = 'x'.repeat(120_000);
    const fetch = vi.fn(async () =>
      respond(body, { status: 200, headers: { 'content-type': 'text/plain' } })
    );
    const first = await webFetch('https://a.example/', {}, { fetch, lookup: publicLookup });
    expect(first.text.length).toBe(50_000);
    expect(first.nextOffset).toBe(50_000);
    expect(formatFetchResult(first)).toContain('offset=50000');
    const last = await webFetch(
      'https://a.example/',
      { offset: 100_000 },
      { fetch, lookup: publicLookup }
    );
    expect(last.text.length).toBe(20_000);
    expect(last.nextOffset).toBeUndefined();
  });

  it('结果带不可信内容提示与状态码', async () => {
    const fetch = vi.fn(async () =>
      respond('gone', { status: 404, headers: { 'content-type': 'text/plain' } })
    );
    const text = formatFetchResult(
      await webFetch('https://a.example/', {}, { fetch, lookup: publicLookup })
    );
    expect(text).toContain('HTTP 404');
    expect(text).toMatch(/untrusted/i);
  });
});
