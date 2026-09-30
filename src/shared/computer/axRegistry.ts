import { StaleRefError } from './errors';

interface Registered<T> {
  handle: T;
  targetKey: string;
  generation: number;
  epoch: string | undefined;
}

export const AX_STALE_HANDLE = 'AX_STALE_HANDLE';

/** worker 句柄：ax-<纪元>-<序号>；worker 重启后纪元变化，旧句柄不能解析到新元素。 */
export function formatAxHandle(epoch: string, id: number): string {
  return `ax-${epoch}-${id}`;
}

export function parseAxHandle(handle: string): { epoch: string; id: number } | null {
  const match = /^ax-([0-9a-z]+)-([1-9]\d*)$/u.exec(handle);
  if (!match) return null;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) ? { epoch: match[1], id } : null;
}

export function axHandleEpoch(handle: string): string | undefined {
  return parseAxHandle(handle)?.epoch;
}

export function isAxStaleHandleError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith(AX_STALE_HANDLE) ||
    /^ax\S* expired; re-run ax\(\)\/find\(\)/u.test(error.message)
  );
}

/**
 * 每个 target（窗口）一份 generation。新 snapshot 作废更早一代；
 * 当前与紧邻上一代仍可解析，和 browser [ref=eN] 一样。
 * 传入 epochOf 时，出现新纪元的句柄会作废所有旧纪元条目。
 */
export class AxRegistry<T> {
  private nextRef = 1;
  private epoch: string | undefined;
  private readonly generations = new Map<string, number>();
  private readonly entries = new Map<number, Registered<T>>();

  constructor(private readonly epochOf?: (handle: T) => string | undefined) {}

  beginSnapshot(target: string): number {
    const generation = (this.generations.get(target) ?? 0) + 1;
    this.generations.set(target, generation);
    for (const [id, entry] of this.entries) {
      if (entry.targetKey === target && entry.generation + 1 < generation) {
        this.entries.delete(id);
      }
    }
    return generation;
  }

  register(target: string, generation: number, handle: T): string {
    const epoch = this.epochOf?.(handle);
    if (epoch !== undefined && epoch !== this.epoch) {
      this.epoch = epoch;
      for (const [id, entry] of this.entries) {
        if (entry.epoch !== epoch) this.entries.delete(id);
      }
    }
    const id = this.nextRef++;
    this.entries.set(id, { handle, targetKey: target, generation, epoch });
    return `e${id}`;
  }

  adopt(parentRef: string, handle: T): string {
    const parent = this.lookup(parentRef);
    return this.register(parent.targetKey, parent.generation, handle);
  }

  resolve(reference: string): T {
    return this.lookup(reference).handle;
  }

  targetOf(reference: string): string {
    return this.lookup(reference).targetKey;
  }

  clear(): void {
    this.nextRef = 1;
    this.epoch = undefined;
    this.generations.clear();
    this.entries.clear();
  }

  private lookup(reference: string): Registered<T> {
    const id = parseRefId(reference);
    const entry = id === null ? undefined : this.entries.get(id);
    if (!entry || id === null) throw new StaleRefError(reference);
    if (this.epochOf && entry.epoch !== this.epoch) {
      this.entries.delete(id);
      throw new StaleRefError(reference);
    }
    return entry;
  }
}

function parseRefId(reference: string): number | null {
  if (!/^e\d+$/u.test(reference)) return null;
  const id = Number(reference.slice(1));
  return Number.isInteger(id) && id > 0 ? id : null;
}
