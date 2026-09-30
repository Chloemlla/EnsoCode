export function normalizeScrollDelta(raw: Record<string, unknown>): { dx: number; dy: number } {
  const num = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    dx: num(raw.dx ?? raw.deltaX ?? raw.delta_x),
    dy: num(raw.dy ?? raw.deltaY ?? raw.delta_y ?? raw.amount),
  };
}
