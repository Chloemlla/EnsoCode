import { useSyncExternalStore } from 'react';

/** 与 Tailwind `md` 断点一致；桌面主窗口 minWidth=800，故只有远程浏览器窄屏会命中。 */
export const MOBILE_MAX_WIDTH = 767;

export const isMobileWidth = (width: number): boolean => width <= MOBILE_MAX_WIDTH;

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => 1024
  );
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isMobileWidth(window.innerWidth),
    () => false
  );
}
