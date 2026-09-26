export const DEFAULT_SSH_TIMEOUT_SECONDS = 30;
export const MIN_SSH_TIMEOUT_SECONDS = 5;
export const MAX_SSH_TIMEOUT_SECONDS = 300;

export function normalizeSshTimeoutSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_SSH_TIMEOUT_SECONDS;
  return Math.min(MAX_SSH_TIMEOUT_SECONDS, Math.max(MIN_SSH_TIMEOUT_SECONDS, value));
}

export function parseSshTimeoutSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < MIN_SSH_TIMEOUT_SECONDS || value > MAX_SSH_TIMEOUT_SECONDS) return null;
  return value;
}
