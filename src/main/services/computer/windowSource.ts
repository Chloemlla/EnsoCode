export function isListedCgWindowLayer(layer: number): boolean {
  return layer >= 0 && layer <= 8;
}

export function findCapturerWindowSource<T extends { id: string }>(
  sources: T[],
  target: string
): T | undefined {
  return sources.find(
    (item) =>
      item.id === target || item.id.endsWith(`:${target}:0`) || item.id.includes(`:${target}:`)
  );
}

export function thumbnailCropForWindow(input: {
  window: { x: number; y: number; width: number; height: number };
  display: { x: number; y: number; width: number; height: number };
  thumbnailWidth: number;
  thumbnailHeight: number;
}): { x: number; y: number; width: number; height: number } | undefined {
  if (
    input.display.width <= 0 ||
    input.display.height <= 0 ||
    input.window.width <= 0 ||
    input.window.height <= 0
  ) {
    return undefined;
  }
  const scaleX = input.thumbnailWidth / input.display.width;
  const scaleY = input.thumbnailHeight / input.display.height;
  const x = Math.max(0, Math.round((input.window.x - input.display.x) * scaleX));
  const y = Math.max(0, Math.round((input.window.y - input.display.y) * scaleY));
  if (x >= input.thumbnailWidth || y >= input.thumbnailHeight) return undefined;
  return {
    x,
    y,
    width: Math.max(1, Math.min(input.thumbnailWidth - x, Math.round(input.window.width * scaleX))),
    height: Math.max(
      1,
      Math.min(input.thumbnailHeight - y, Math.round(input.window.height * scaleY))
    ),
  };
}
