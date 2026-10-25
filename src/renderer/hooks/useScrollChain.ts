import * as React from 'react';

/**
 * 让嵌套滚动区的滚轮到边界后继续带动外层。
 *
 * 浏览器原生有链式滚动，但内层一旦滚到头就停在原地，手感像"卡住"；
 * 内层没有可滚内容时（内容刚好不溢出）更是完全吃掉滚轮。这里在边界处
 * 主动把 deltaY 交给最近的 ScrollArea viewport，滚动始终连续。
 */
export function useScrollChain<T extends HTMLElement = HTMLDivElement>() {
  const ref = React.useRef<T | null>(null);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      const atTop = element.scrollTop <= 0;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
        const outer = element.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
        if (!outer) return;
        event.preventDefault();
        outer.scrollBy({ top: event.deltaY });
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return ref;
}
