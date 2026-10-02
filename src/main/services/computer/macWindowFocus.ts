import type { ComputerWindowInfo } from '@shared/computer/types';

export function withMacWindowFocus(
  windows: ComputerWindowInfo[],
  focus?: { pid: number; windowId: string }
): ComputerWindowInfo[] {
  return windows.map((window) => ({
    ...window,
    focused: focus !== undefined && window.pid === focus.pid && window.id === focus.windowId,
  }));
}
