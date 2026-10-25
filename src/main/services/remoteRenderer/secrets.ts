/** 远端拿到的设置里密钥一律替换成哨兵；写回时按路径从宿主磁盘回填，明文不离开 Main。 */
export const REMOTE_SECRET_SENTINEL = '••••••••enso-remote-secret';

const SECRET_KEY = /(apikey|api_key|secret|password|token|authorization|cookie)$/i;
/** 整个对象的值都视为密钥（MCP env、自定义请求头） */
const SECRET_CONTAINER = new Set(['env', 'headers']);

type Json = unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redact(value: Json, secret: boolean): Json {
  if (typeof value === 'string') return secret && value.length > 0 ? REMOTE_SECRET_SENTINEL : value;
  if (Array.isArray(value)) return value.map((item) => redact(item, secret));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redact(item, secret || SECRET_KEY.test(key) || SECRET_CONTAINER.has(key));
  }
  return out;
}

export function redactSecrets<T>(value: T): T {
  return redact(value, false) as T;
}

function idOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
}

function restore(next: Json, current: Json): Json {
  if (next === REMOTE_SECRET_SENTINEL) return typeof current === 'string' ? current : '';
  if (Array.isArray(next)) {
    const previous = Array.isArray(current) ? current : [];
    return next.map((item, index) => {
      const id = idOf(item);
      const match = id === undefined ? previous[index] : previous.find((p) => idOf(p) === id);
      return restore(item, match);
    });
  }
  if (!isRecord(next)) return next;
  const previous = isRecord(current) ? current : {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(next)) out[key] = restore(item, previous[key]);
  return out;
}

export function restoreSecrets<T>(next: T, current: unknown): T {
  return restore(next, current) as T;
}

export function containsSentinel(value: unknown): boolean {
  if (value === REMOTE_SECRET_SENTINEL) return true;
  if (Array.isArray(value)) return value.some(containsSentinel);
  return isRecord(value) && Object.values(value).some(containsSentinel);
}
