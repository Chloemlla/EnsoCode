import { StaleRefError } from './errors';

interface Registered<T> {
  handle: T;
  targetKey: string;
  generation: number;
}

/**
 * 每个 target（窗口）一份 generation。新 snapshot 作废更早一代；
 * 当前与紧邻上一代仍可解析，和 browser [ref=eN] 一样。
 */
export class AxRegistry<T> {
  private nextRef = 1;
  private readonly generations = new Map<string, number>();
  private readonly entries = new Map<number, Registered<T>>();

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
    const id = this.nextRef++;
    this.entries.set(id, { handle, targetKey: target, generation });
    return `e${id}`;
  }

  adopt(parentRef: string, handle: T): string {
    const parentId = parseRefId(parentRef);
    const parent = parentId === null ? undefined : this.entries.get(parentId);
    if (!parent) throw new StaleRefError(parentRef);
    return this.register(parent.targetKey, parent.generation, handle);
  }

  resolve(reference: string): T {
    const id = parseRefId(reference);
    const entry = id === null ? undefined : this.entries.get(id);
    if (!entry) throw new StaleRefError(reference);
    return entry.handle;
  }

  targetOf(reference: string): string {
    const id = parseRefId(reference);
    const entry = id === null ? undefined : this.entries.get(id);
    if (!entry) throw new StaleRefError(reference);
    return entry.targetKey;
  }

  clear(): void {
    this.nextRef = 1;
    this.generations.clear();
    this.entries.clear();
  }
}

function parseRefId(reference: string): number | null {
  if (!/^e\d+$/u.test(reference)) return null;
  const id = Number(reference.slice(1));
  return Number.isInteger(id) && id > 0 ? id : null;
}
