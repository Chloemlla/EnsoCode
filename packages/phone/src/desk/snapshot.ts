/**
 * 启动快照：上次界面的静态副本（去掉脚本），启动时先盖在 renderer 上，数据到齐再淡出。
 *
 * 不缓存数据本身：renderer 的状态以桌面为准，拿旧数据起步再写回会覆盖桌面上更新过的内容。
 * 快照只读、不跑脚本，存在该构建的 SW 缓存里，桌面升级换构建时随旧缓存一起清掉。
 * 样式内联、用 srcdoc 挂载：不依赖 SW 拦截 iframe 导航（iOS 上沙箱 iframe 可能直连中继拿到空页面）。
 */

const SNAPSHOT_FILE = '__snapshot.html';
const CHARS_HEADER = 'x-desk-chars';
/** 盖着的上限：桌面不在线等情况下也不能一直挡住 */
const MAX_SNAPSHOT_MS = 20_000;
const SETTLED_MS = 2_500;
/** 文字太少的快照（存的时候 renderer 正在重载）盖上去只是一片空白 */
const MIN_SNAPSHOT_CHARS = 200;

export interface SnapshotProgress {
  elapsed: number;
  /** renderer 当前可见文字量 */
  liveChars: number;
  snapChars: number;
  settingsLoaded: boolean;
  /** renderer 文字量多久没变了 */
  stableFor: number;
}

export function snapshotReady(p: SnapshotProgress): boolean {
  if (p.elapsed >= MAX_SNAPSHOT_MS) return true;
  if (!p.settingsLoaded) return false;
  return p.liveChars >= p.snapChars * 0.8 || p.stableFor >= SETTLED_MS;
}

const snapshotUrl = (base: string) => `${location.origin}${base}/${SNAPSHOT_FILE}`;

/** 弹层、菜单是瞬时状态，留在快照里像卡住了 */
const TRANSIENT =
  'script, iframe, link[rel="modulepreload"], meta[http-equiv], [role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper]';

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** 内联后样式的基准从 css 文件变成文档，相对 url() 要先按 css 文件位置解析 */
export function absolutizeCssUrls(css: string, sheetHref: string): string {
  return css.replace(CSS_URL, (whole, _quote: string, url: string) =>
    /^(?:[a-z][\w+.-]*:|\/|#)/i.test(url) ? whole : `url("${new URL(url, sheetHref).href}")`
  );
}

/** 把同源样式表替换成 <style>，快照不再需要另外请求 css */
function inlineStyles(doc: Document, clone: HTMLElement): void {
  const sheets = new Map<string, CSSStyleSheet>();
  for (const sheet of doc.styleSheets) if (sheet.href) sheets.set(sheet.href, sheet);
  for (const link of clone.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    const href = new URL(link.getAttribute('href') ?? '', doc.baseURI).href;
    const sheet = sheets.get(href);
    if (!sheet) continue;
    let css = '';
    try {
      for (const rule of sheet.cssRules) css += `${rule.cssText}\n`;
    } catch {
      continue;
    }
    const style = doc.createElement('style');
    style.textContent = absolutizeCssUrls(css, href);
    link.replaceWith(style);
  }
}

export async function saveSnapshot(cacheName: string, base: string, doc: Document): Promise<void> {
  const body = doc.body;
  if (!body) return;
  const chars = body.textContent?.length ?? 0;
  const marked: Element[] = [];
  for (const el of doc.querySelectorAll('*')) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      el.setAttribute('data-desk-scroll', `${el.scrollTop},${el.scrollLeft}`);
      marked.push(el);
    }
  }
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  for (const el of marked) el.removeAttribute('data-desk-scroll');
  for (const el of clone.querySelectorAll(TRANSIENT)) el.remove();
  for (const img of clone.querySelectorAll('img[src^="blob:"]')) img.removeAttribute('src');
  inlineStyles(doc, clone);
  const head = clone.querySelector('head');
  if (!head) return;
  const baseEl = doc.createElement('base');
  baseEl.href = `${base}/`;
  head.prepend(baseEl);
  const html = `<!doctype html>${clone.outerHTML}`;
  const cache = await caches.open(cacheName);
  await cache.put(
    snapshotUrl(base),
    new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', [CHARS_HEADER]: String(chars) },
    })
  );
}

/** 读出快照及其文字量（文字量用于判断 renderer 何时追上） */
export async function loadSnapshot(
  cacheName: string,
  base: string
): Promise<{ html: string; chars: number } | null> {
  try {
    const hit = await (await caches.open(cacheName)).match(snapshotUrl(base));
    if (!hit) return null;
    const chars = Number(hit.headers.get(CHARS_HEADER)) || 0;
    if (chars < MIN_SNAPSHOT_CHARS) return null;
    return { html: await hit.text(), chars };
  } catch {
    return null;
  }
}

/** 快照 iframe：沙箱不允许脚本；载入后恢复各滚动区域的位置 */
export function mountSnapshot(container: HTMLElement, html: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.className = 'snapshot';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.addEventListener(
    'load',
    () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      for (const el of doc.querySelectorAll('[data-desk-scroll]')) {
        const [top, left] = (el.getAttribute('data-desk-scroll') ?? '').split(',').map(Number);
        el.scrollTop = top || 0;
        el.scrollLeft = left || 0;
      }
    },
    { once: true }
  );
  iframe.srcdoc = html;
  container.appendChild(iframe);
  return iframe;
}

/** 删掉已不在配对列表里的设备的快照 */
export async function pruneSnapshots(cacheName: string, pairIds: string[]): Promise<void> {
  try {
    const keep = new Set(pairIds.map((id) => `/desk/r/${encodeURIComponent(id)}/`));
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      const path = new URL(request.url).pathname;
      if (path.endsWith(`/${SNAPSHOT_FILE}`) && ![...keep].some((p) => path.startsWith(p)))
        await cache.delete(request);
    }
  } catch {}
}
