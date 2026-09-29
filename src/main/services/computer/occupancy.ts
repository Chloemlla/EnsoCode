export type OccupancyReason = 'esc' | 'user';

/** keys 含 Escape 时，期间注销 Esc 热键，避免全局热键吞掉发给目标 App 的按键。 */
export interface SyntheticInput {
  keys?: readonly string[];
}

export interface OccupancyDeps {
  show(): void;
  hide(): void;
  registerEsc(handler: () => void): () => void;
  /** 距上次物理输入的秒数；null 表示无法检测。 */
  hidSeconds?: () => number | null;
  now?: () => number;
  pollMs?: number;
  hidThreshold?: number;
  syntheticGraceMs?: number;
}

const HID_THRESHOLD = 0.08;
const SYNTHETIC_GRACE_MS = 150;

function hasEscape(keys: readonly string[] | undefined): boolean {
  return (keys ?? []).some((key) => /^esc(ape)?$/i.test(key.trim()));
}

export class ComputerOccupancy {
  private generation = 0;
  private occupying = false;
  private onAbort?: () => void;
  private unesc?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private synthetic = false;
  private graceUntil = 0;
  private syntheticEsc = false;
  private pendingEsc = false;
  private escSuspended = false;
  private escResume?: ReturnType<typeof setTimeout>;

  constructor(private readonly deps: OccupancyDeps) {}

  start(onAbort: () => void): number {
    this.generation += 1;
    this.onAbort = onAbort;
    if (!this.occupying) {
      this.occupying = true;
      this.deps.show();
      this.registerEsc();
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

  /** 能否检测用户物理键鼠；false 时不能靠 HID 让路，只剩 Esc 取消。 */
  canDetectUserInput(): boolean {
    return typeof this.deps.hidSeconds?.() === 'number';
  }

  beginSynthetic(input?: SyntheticInput): void {
    this.synthetic = true;
    this.syntheticEsc = hasEscape(input?.keys);
    if (!this.syntheticEsc || !this.occupying) return;
    this.clearEscResume();
    if (this.escSuspended) return;
    this.escSuspended = true;
    this.unregisterEsc();
  }

  endSynthetic(): void {
    const pending = this.pendingEsc;
    this.synthetic = false;
    this.syntheticEsc = false;
    this.pendingEsc = false;
    const grace = this.deps.syntheticGraceMs ?? SYNTHETIC_GRACE_MS;
    this.graceUntil = this.now() + grace;
    if (pending) {
      this.abort();
      return;
    }
    if (this.escSuspended && this.occupying) {
      this.clearEscResume();
      this.escResume = setTimeout(() => this.resumeEsc(), grace);
    }
  }

  tick(): void {
    if (!this.occupying || this.synthetic) return;
    if (this.now() < this.graceUntil) return;
    const hid = this.deps.hidSeconds?.();
    if (typeof hid === 'number' && hid < (this.deps.hidThreshold ?? HID_THRESHOLD)) {
      this.yield('user');
    }
  }

  private yield(reason: OccupancyReason): void {
    if (!this.occupying) return;
    if (reason === 'esc') {
      // 合成期间的 Esc 若不是我们自己发的，等 endSynthetic 再中止
      if (this.synthetic) {
        if (!this.syntheticEsc) this.pendingEsc = true;
        return;
      }
    } else if (this.synthetic || this.now() < this.graceUntil) {
      return;
    }
    this.abort();
  }

  private abort(): void {
    if (!this.occupying) return;
    const abort = this.onAbort;
    this.onAbort = undefined;
    abort?.();
    this.teardown();
  }

  private registerEsc(): void {
    this.unesc = this.deps.registerEsc(() => this.yield('esc'));
  }

  private unregisterEsc(): void {
    const unesc = this.unesc;
    this.unesc = undefined;
    unesc?.();
  }

  private resumeEsc(): void {
    this.escResume = undefined;
    if (!this.occupying || !this.escSuspended || this.syntheticEsc) return;
    this.escSuspended = false;
    this.registerEsc();
  }

  private clearEscResume(): void {
    if (this.escResume === undefined) return;
    clearTimeout(this.escResume);
    this.escResume = undefined;
  }

  private teardown(): void {
    if (!this.occupying) return;
    this.occupying = false;
    this.onAbort = undefined;
    this.synthetic = false;
    this.syntheticEsc = false;
    this.pendingEsc = false;
    this.escSuspended = false;
    this.clearEscResume();
    this.graceUntil = 0;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.unregisterEsc();
    this.deps.hide();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
