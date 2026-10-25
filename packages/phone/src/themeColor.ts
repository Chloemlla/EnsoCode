/**
 * 浏览器取「第一个匹配的」theme-color 标签，所以必须清掉 html 里的兜底并插到 head 最前，
 * 否则动态值永远轮不上。
 */
export function setThemeColor(color: string): void {
  const current = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (current?.content === color && !current.media) return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = color;
  document.head.prepend(meta);
}

/**
 * 把任意 CSS 颜色规约成 rgb()（兼容性最好）。canvas 的 fillStyle 对 oklch 是原样回吐、
 * 不做转换，所以实际画一像素再读回 —— 这一步一定得到 sRGB 数值。
 */
export function toRgb(color: string): string {
  if (color.startsWith('rgb') || color.startsWith('#')) return color;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return color;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return color;
  }
}
