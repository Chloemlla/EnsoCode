import { nativeImage } from 'electron';

export function cropPngAround(
  png: Buffer,
  x: number,
  y: number,
  radius = 48
): { png: Buffer; width: number; height: number } | undefined {
  try {
    const image = nativeImage.createFromBuffer(png);
    const { width, height } = image.getSize();
    if (width < 1 || height < 1) return undefined;
    const size = Math.min(radius * 2, width, height);
    const left = Math.max(0, Math.min(width - size, Math.round(x) - Math.floor(size / 2)));
    const top = Math.max(0, Math.min(height - size, Math.round(y) - Math.floor(size / 2)));
    const out = image.crop({ x: left, y: top, width: size, height: size }).toPNG();
    if (!out?.length) return undefined;
    return { png: out, width: size, height: size };
  } catch {
    return undefined;
  }
}
