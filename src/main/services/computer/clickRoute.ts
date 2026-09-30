export type ClickRoute = 'skyClick' | 'postToPid' | 'hid' | 'unavailable';

export function resolveClickRoute(input: {
  delivery?: 'background' | 'foreground';
  pid?: number;
  windowId?: number;
}): ClickRoute {
  if (
    typeof input.pid === 'number' &&
    input.pid > 0 &&
    typeof input.windowId === 'number' &&
    input.windowId > 0
  ) {
    return 'skyClick';
  }
  if (typeof input.pid === 'number' && input.pid > 0) return 'postToPid';
  if ((input.delivery ?? 'background') === 'foreground') return 'hid';
  return 'unavailable';
}
