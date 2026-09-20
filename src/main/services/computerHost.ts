import { normalizeComputerParams } from '@shared/computer/params';
import type { ComputerCapabilities, ComputerRunResult } from '@shared/computer/types';
import type { ComputerOp } from '@shared/types/agent';
import type { DesktopBackend } from './computer/backend';
import {
  type ComputerGuestSession,
  createComputerGuestSession,
  runComputerGuest,
} from './computer/guest';
import { openMacPrivacySettings } from './computer/macPrivacySettings';
import { ComputerOccupancy } from './computer/occupancy';
import { createElectronOccupancyDeps } from './computer/occupancyOverlay';
import { createDesktopBackend } from './computer/platform';

interface SessionState {
  guest: ComputerGuestSession;
  backend: DesktopBackend;
  running?: AbortController;
}

export class ComputerHost {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private backendFactory: () => DesktopBackend,
    private occupancy?: ComputerOccupancy
  ) {}

  setBackendFactory(factory: () => DesktopBackend): void {
    this.backendFactory = factory;
  }

  async invoke(sessionId: string, op: ComputerOp, params: unknown): Promise<ComputerRunResult> {
    if (op !== 'run') throw new Error(`unsupported computer op '${op}'`);
    const normalized = normalizeComputerParams(params);
    if (!normalized) throw new Error('computer requires code');
    const existing = this.sessions.get(sessionId);
    existing?.running?.abort();
    const guest = existing?.guest ?? createComputerGuestSession();
    const backend = existing?.backend ?? this.backendFactory();
    const running = new AbortController();
    this.sessions.set(sessionId, { guest, backend, running });
    const occupying = Boolean(this.occupancy) && !normalized.readOnly;
    const occupancyGen = occupying ? this.occupancy?.start(() => running.abort()) : undefined;
    try {
      return await runComputerGuest({
        code: normalized.code,
        readOnly: normalized.readOnly,
        timeoutMs: normalized.timeoutSec * 1000,
        signal: running.signal,
        backend,
        session: guest,
        occupancy: occupying ? this.occupancy : undefined,
      });
    } finally {
      if (occupancyGen !== undefined) this.occupancy?.stop(occupancyGen);
      const current = this.sessions.get(sessionId);
      if (current?.running === running) current.running = undefined;
    }
  }

  async capabilities(): Promise<ComputerCapabilities> {
    return this.backendFactory().capabilities();
  }

  async openPermissionSettings(
    kind: 'screen' | 'accessibility'
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await openMacPrivacySettings(kind);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    session?.running?.abort();
    this.sessions.delete(sessionId);
  }
}

export const computerHost = new ComputerHost(() => {
  return createDesktopBackend();
}, new ComputerOccupancy(createElectronOccupancyDeps()));
