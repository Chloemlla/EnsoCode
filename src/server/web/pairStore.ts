import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  claim,
  isExpired,
  type PairState,
  request,
  tokenValid,
} from '../../../packages/relay/src/pairing';

/** 内置中继的配对表：含长期 token，落盘 0600；状态机与 Cloudflare / Go 中继共用 packages/relay */
export class PairStore {
  private readonly pairs = new Map<string, PairState>();

  constructor(private readonly file: string) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, PairState>;
      for (const [id, state] of Object.entries(saved)) {
        if (state?.phase === 'authorized') this.pairs.set(id, state);
      }
    } catch {}
  }

  get(id: string): PairState | undefined {
    return this.pairs.get(id);
  }

  request(id: string, hostPublicKey: string, now: number): PairState {
    this.prune(now);
    const prev = this.pairs.get(id);
    const next = request(prev, now, hostPublicKey);
    if (next !== prev) this.pairs.set(id, next);
    return next;
  }

  claim(id: string, boxedKey: string, deviceName: string, now: number): PairState | string {
    const result = claim(this.pairs.get(id), now, boxedKey, deviceName);
    if (!result.ok) return result.error;
    this.pairs.set(id, result.next);
    this.save(now);
    return result.next;
  }

  revoke(id: string, token: string, now: number): boolean {
    const state = this.pairs.get(id);
    if (!tokenValid(state, 'host', token) && !tokenValid(state, 'guest', token)) return false;
    this.pairs.delete(id);
    this.save(now);
    return true;
  }

  private prune(now: number): void {
    for (const [id, state] of this.pairs) if (isExpired(state, now)) this.pairs.delete(id);
  }

  /** 未认领的配对码只活 60 秒，不落盘 */
  private save(now: number): void {
    this.prune(now);
    const saved = Object.fromEntries([...this.pairs].filter(([, s]) => s.phase === 'authorized'));
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
