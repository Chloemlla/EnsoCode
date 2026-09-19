import { normalizeComputerParams } from '@shared/computer/params';
import type { ComputerCapabilities, ComputerRunResult } from '@shared/computer/types';
import type { ComputerOp } from '@shared/types/agent';
import { desktopCapturer, shell, systemPreferences } from 'electron';
import type { DesktopBackend } from './computer/backend';
import {
  type ComputerGuestSession,
  createComputerGuestSession,
  runComputerGuest,
} from './computer/guest';
import { promptComputerPermission } from './computer/permissionPrompt';
import { createDesktopBackend } from './computer/platform';
import { requestScreenCaptureAccess } from './computer/screenCaptureAccess';

interface SessionState {
  guest: ComputerGuestSession;
  running?: AbortController;
}

export class ComputerHost {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private backendFactory: () => DesktopBackend) {}

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
    const running = new AbortController();
    this.sessions.set(sessionId, { guest, running });
    try {
      return await runComputerGuest({
        code: normalized.code,
        readOnly: normalized.readOnly,
        timeoutMs: normalized.timeoutSec * 1000,
        signal: running.signal,
        backend: this.backendFactory(),
        session: guest,
      });
    } finally {
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
    const url =
      kind === 'screen'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
    await promptComputerPermission(kind, {
      requestScreen: async () => {
        if (await requestScreenCaptureAccess()) return true;
        try {
          await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1, height: 1 },
          });
        } catch {
          // getSources can throw before TCC is recorded
        }
        try {
          return systemPreferences.getMediaAccessStatus('screen') === 'granted';
        } catch {
          return false;
        }
      },
      requestAx: (prompt) => {
        try {
          return systemPreferences.isTrustedAccessibilityClient(prompt);
        } catch {
          return false;
        }
      },
      openSettings: () => {
        void shell.openExternal(url).catch(() => {});
      },
    });
    return { ok: true };
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    session?.running?.abort();
    this.sessions.delete(sessionId);
  }
}

export const computerHost = new ComputerHost(() => {
  return createDesktopBackend();
});
