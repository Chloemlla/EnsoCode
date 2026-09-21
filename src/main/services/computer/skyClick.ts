export type SkyClickEventKind = 'moved' | 'down' | 'up';
export type SkyClickPointKind = 'target' | 'primer';

export type SkyClickEventStep = {
  kind: SkyClickEventKind;
  pointKind: SkyClickPointKind;
  clickState: number;
  phase: number;
  delayAfterMs: number;
};

const CG_EVENT_TYPE = { moved: 5, down: 1, up: 2 } as const;

export function skyClickCgEventType(kind: SkyClickEventKind): number {
  return CG_EVENT_TYPE[kind];
}

export function skyClickEventRecipe(clickCount: number): SkyClickEventStep[] {
  if (clickCount !== 1 && clickCount !== 2) {
    throw new Error("sky_click supports click_count 1 or 2");
  }
  const steps: SkyClickEventStep[] = [
    { kind: 'moved', pointKind: 'target', clickState: 0, phase: 2, delayAfterMs: 15 },
    { kind: 'down', pointKind: 'primer', clickState: 1, phase: 1, delayAfterMs: 1 },
    { kind: 'up', pointKind: 'primer', clickState: 1, phase: 2, delayAfterMs: 100 },
  ];
  for (let pair = 1; pair <= clickCount; pair += 1) {
    steps.push({
      kind: 'down',
      pointKind: 'target',
      clickState: pair,
      phase: 3,
      delayAfterMs: 1,
    });
    steps.push({
      kind: 'up',
      pointKind: 'target',
      clickState: pair,
      phase: 3,
      delayAfterMs: pair < clickCount ? 80 : 0,
    });
  }
  return steps;
}

export function skyLightActivationRecord(windowId: number, focused: boolean): Uint8Array {
  const record = new Uint8Array(0xf8);
  record[0x04] = 0xf8;
  record[0x08] = 0x0d;
  record[0x3c] = windowId & 0xff;
  record[0x3d] = (windowId >> 8) & 0xff;
  record[0x3e] = (windowId >> 16) & 0xff;
  record[0x3f] = (windowId >> 24) & 0xff;
  record[0x8a] = focused ? 0x01 : 0x02;
  return record;
}

export function skyClickLocalPoint(
  screen: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  return { x: screen.x - bounds.x, y: screen.y - bounds.y };
}

export function skyClickWindowMatchesTarget(
  windows: Array<{ id: string; pid?: number; onScreen?: boolean }>,
  windowId: number,
  pid: number
): boolean {
  return windows.some(
    (window) =>
      Number(window.id) === windowId && window.pid === pid && window.onScreen !== false
  );
}

export const SKY_CLICK_UNAVAILABLE = 'SKY_CLICK_UNAVAILABLE';

export function isSkyClickUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === SKY_CLICK_UNAVAILABLE || message.startsWith(`${SKY_CLICK_UNAVAILABLE}:`);
}
