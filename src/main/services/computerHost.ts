import { normalizeComputerParams } from '@shared/computer/params';
import type { ComputerCapabilities, ComputerRunResult } from '@shared/computer/types';
import type { ComputerOp } from '@shared/types/agent';
import type { DesktopBackend } from './computer/backend';
import {
  type ComputerGuestSession,
  createComputerGuestSession,
  disposeComputerGuestVm,
  runComputerGuest,
} from './computer/guest';
import { openMacPrivacySettings } from './computer/macPrivacySettings';
import { ComputerOccupancy } from './computer/occupancy';
import { createElectronOccupancyDeps } from './computer/occupancyOverlay';
import { createDesktopBackend } from './computer/platform';

const DEFAULT_LEASE_WAIT_MS = 20_000;
const BUSY_MESSAGE =
  'Another session is using the computer right now. Wait for it to finish, then try again.';
const YIELD_MESSAGE =
  'The user took over the desktop (Esc or physical input). Stop and ask the user before using computer again.';

interface RunningRun {
  controller: AbortController;
  done: Promise<void>;
}

interface SessionState {
  guest: ComputerGuestSession;
  running?: RunningRun;
}

function abortedError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error && reason.name.startsWith('Computer')
    ? reason
    : new Error('Computer action aborted');
}

/**
 * Main 侧桌面 computer 宿主。桌面只有一个：所有 session 共享一把租约，
 * 同一时刻只跑一个 run；同 session 新 run 先中止并等旧 run 收尾。
 */
export class ComputerHost {
  private readonly sessions = new Map<string, SessionState>();
  private backend?: DesktopBackend;
  private lease?: { sessionId: string; released: Promise<void> };
  private readonly leaseWaitMs: number;

  constructor(
    private backendFactory: () => DesktopBackend,
    private occupancy?: ComputerOccupancy,
    options: { leaseWaitMs?: number } = {}
  ) {
    this.leaseWaitMs = options.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS;
  }

  setBackendFactory(factory: () => DesktopBackend): void {
    this.backendFactory = factory;
    this.backend = undefined;
  }

  private sharedBackend(): DesktopBackend {
    this.backend ??= this.backendFactory();
    return this.backend;
  }

  async invoke(
    sessionId: string,
    op: ComputerOp,
    params: unknown,
    signal?: AbortSignal
  ): Promise<ComputerRunResult> {
    if (op !== 'run') throw new Error(`unsupported computer op '${op}'`);
    const normalized = normalizeComputerParams(params);
    if (!normalized) throw new Error('computer requires code');
    if (signal?.aborted) throw new Error('Computer action aborted');

    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { guest: createComputerGuestSession() };
      this.sessions.set(sessionId, state);
    }
    const previous = state.running;
    if (previous) {
      previous.controller.abort();
      await previous.done;
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const { promise: done, resolve: markDone } = Promise.withResolvers<void>();
    const running: RunningRun = { controller, done };
    state.running = running;
    const guest = state.guest;
    try {
      const release = await this.acquire(sessionId, controller.signal);
      const occupying = Boolean(this.occupancy) && !normalized.readOnly;
      const occupancyGen = occupying
        ? this.occupancy?.start(() => {
            const error = new Error(YIELD_MESSAGE);
            error.name = 'ComputerYieldError';
            controller.abort(error);
          })
        : undefined;
      try {
        return await runComputerGuest({
          code: normalized.code,
          readOnly: normalized.readOnly,
          timeoutMs: normalized.timeoutSec * 1000,
          signal: controller.signal,
          backend: this.sharedBackend(),
          session: guest,
          occupancy: occupying ? this.occupancy : undefined,
          persistVm: true,
        });
      } finally {
        if (occupancyGen !== undefined) this.occupancy?.stop(occupancyGen);
        release();
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (state.running === running) state.running = undefined;
      markDone();
    }
  }

  private async acquire(sessionId: string, signal: AbortSignal): Promise<() => void> {
    const deadline = Date.now() + this.leaseWaitMs;
    while (this.lease) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(BUSY_MESSAGE);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      await Promise.race([
        this.lease.released,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remaining);
        }),
        new Promise<void>((resolve) => {
          onAbort = () => resolve();
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (signal.aborted) throw abortedError(signal);
    }
    const { promise: released, resolve } = Promise.withResolvers<void>();
    const lease = { sessionId, released };
    this.lease = lease;
    return () => {
      if (this.lease === lease) this.lease = undefined;
      resolve();
    };
  }

  async capabilities(): Promise<ComputerCapabilities> {
    return this.sharedBackend().capabilities();
  }

  async openPermissionSettings(
    kind: 'screen' | 'accessibility'
  ): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'Permission settings are only needed on macOS' };
    }
    try {
      await openMacPrivacySettings(kind);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 中止该 session 的 run，收尾后释放 VM；之后同 id 再调用会从空 VM 开始 */
  close(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this.sessions.delete(sessionId);
    state.running?.controller.abort();
    void (state.running?.done ?? Promise.resolve()).then(() => disposeComputerGuestVm(state.guest));
  }

  /** worker 退出 / 应用退出：停下所有桌面操作 */
  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.close(sessionId);
  }
}

export const computerHost = new ComputerHost(() => {
  return createDesktopBackend();
}, new ComputerOccupancy(createElectronOccupancyDeps()));
