import type { ComputerWindowInfo } from '@shared/computer/types';

type Rect = Pick<ComputerWindowInfo, 'x' | 'y' | 'width' | 'height'>;

const GRID = 8;

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/**
 * 目标窗口是否被排在它前面的窗口（front-to-back 顺序）整体盖住。
 * Chromium/Electron 窗口被盖住后停止重绘，截图会是旧画面。按网格采样判断。
 */
export function hiddenBehindOthers(windows: ComputerWindowInfo[], targetId: string): boolean {
  const index = windows.findIndex((window) => window.id === targetId);
  const target = windows[index];
  if (!target || index === 0 || target.width <= 0 || target.height <= 0) return false;
  const above = windows.slice(0, index);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const x = target.x + ((col + 0.5) * target.width) / GRID;
      const y = target.y + ((row + 0.5) * target.height) / GRID;
      if (!above.some((rect) => contains(rect, x, y))) return false;
    }
  }
  return true;
}
