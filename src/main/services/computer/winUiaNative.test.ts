import { describe, expect, it } from 'vitest';
import { createWinUiaBridge } from './winUia';
import { loadWinUiaRaw } from './winUiaNative';

describe.skipIf(process.platform !== 'win32')('loadWinUiaRaw', () => {
  it('COM UI Automation 能读到焦点元素', async () => {
    const raw = await loadWinUiaRaw();
    expect(raw).not.toBeNull();
    const el = raw?.focused();
    expect(el).toBeTruthy();
    const node = raw?.describe(el);
    expect(node?.role.startsWith('AX')).toBe(true);
    expect(node?.bounds?.width).toBeGreaterThan(0);
    expect(node?.bounds?.height).toBeGreaterThan(0);
    if (el) raw?.release(el);
  });

  it('bridge 给焦点元素登记 ax- 句柄', async () => {
    const raw = await loadWinUiaRaw();
    expect(raw).not.toBeNull();
    const node = await createWinUiaBridge(raw!).focused();
    expect(node?.ref).toMatch(/^ax-/);
    expect(node?.role.startsWith('AX')).toBe(true);
  });
});
