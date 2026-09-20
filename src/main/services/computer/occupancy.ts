export type OccupancyReason = 'esc' | 'user';

export interface OccupancyDeps {
  show(): void;
  hide(): void;
  registerEsc(handler: () => void): () => void;
  hidSeconds?: () => number;
  now?: () => number;
  pollMs?: number;
  hidThreshold?: number;
  syntheticGraceMs?: number;
}

const HID_THRESHOLD = 0.08;
const SYNTHETIC_GRACE_MS = 150;

export class ComputerOccupancy {
  private generation = 0;
  private occupying = false;
  private onAbort?: () => void;
  private unesc?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private synthetic = false;
  private graceUntil = 0;

  constructor(private readonly deps: OccupancyDeps) {}

  start(onAbort: () => void): number {
    this.generation += 1;
    this.onAbort = onAbort;
    if (!this.occupying) {
      this.occupying = true;
      this.deps.show();
      this.unesc = this.deps.registerEsc(() => this.yield('esc'));
      const pollMs = this.deps.pollMs;
      if (this.deps.hidSeconds && pollMs !== 0) {
        this.timer = setInterval(() => this.tick(), pollMs ?? 80);
      }
    }
    return this.generation;
  }

  stop(generation: number): void {
    if (generation !== this.generation) return;
    this.teardown();
  }

  beginSynthetic(): void {
    this.synthetic = true;
  }

  endSynthetic(): void {
    this.synthetic = false;
    this.graceUntil = this.now() + (this.deps.syntheticGraceMs ?? SYNTHETIC_GRACE_MS);
  }

  tick(): void {
    if (!this.occupying || this.synthetic) return;
    if (this.now() < this.graceUntil) return;
    const hid = this.deps.hidSeconds?.() ?? Number.POSITIVE_INFINITY;
    if (hid < (this.deps.hidThreshold ?? HID_THRESHOLD)) this.yield('user');
  }

  private yield(_reason: OccupancyReason): void {
    if (!this.occupying) return;
    if (this.synthetic || this.now() < this.graceUntil) return;
    const abort = this.onAbort;
    this.onAbort = undefined;
    abort?.();
    this.teardown();
  }

  private teardown(): void {
    if (!this.occupying) return;
    this.occupying = false;
    this.onAbort = undefined;
    this.synthetic = false;
    this.graceUntil = 0;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const unesc = this.unesc;
    this.unesc = undefined;
    unesc?.();
    this.deps.hide();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
