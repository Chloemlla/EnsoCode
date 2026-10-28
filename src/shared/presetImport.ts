export const PRESET_IMPORT_MAX_BYTES = 64 * 1024;

export interface PresetImportDraft {
  name: string;
  role: string;
  tail: string;
  boost: string;
  refusalRetry: boolean;
  refusalRetryPrompt: string;
  suggestedSkills: string[];
  suggestedMcp: string[];
}

const EMPTY_DRAFT: PresetImportDraft = {
  name: '',
  role: '',
  tail: '',
  boost: '',
  refusalRetry: false,
  refusalRetryPrompt: '',
  suggestedSkills: [],
  suggestedMcp: [],
};

function clip(value: unknown, max = PRESET_IMPORT_MAX_BYTES): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').slice(0, max);
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= 40) break;
  }
  return out;
}

export function parsePresetImportBody(
  raw: string
): { ok: true; draft: PresetImportDraft } | { ok: false; error: string } {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) return { ok: false, error: 'Import is empty' };
  if (new TextEncoder().encode(text).length > PRESET_IMPORT_MAX_BYTES) {
    return { ok: false, error: 'Import is too large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'Import must be JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Import must be a JSON object' };
  }
  const record = parsed as Record<string, unknown>;
  const name = clip(record.name, 200).trim();
  if (!name) return { ok: false, error: 'Import name is required' };
  return {
    ok: true,
    draft: {
      ...EMPTY_DRAFT,
      name,
      role: clip(record.role),
      tail: clip(record.tail),
      boost: clip(record.boost),
      refusalRetry: record.refusalRetry === true,
      refusalRetryPrompt: clip(record.refusalRetryPrompt),
      suggestedSkills: names(record.suggestedSkills),
      suggestedMcp: names(record.suggestedMcp),
    },
  };
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function parsePublicHttpsUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return null;
  }
  if (host === '::1' || host === '[::1]' || host.includes(':')) return null;
  if (isPrivateIPv4(host)) return null;
  return url;
}

export async function fetchPresetImport(
  rawUrl: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; draft: PresetImportDraft } | { ok: false; error: string }> {
  let current = parsePublicHttpsUrl(rawUrl);
  if (!current) return { ok: false, error: 'Only public https URLs are allowed' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    for (let hop = 0; hop < 4; hop++) {
      const response = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
      });
      if (response.status >= 300 && response.status < 400) {
        const next = parsePublicHttpsUrl(response.headers.get('location') ?? '');
        if (!next) return { ok: false, error: 'Import redirect is not a public https URL' };
        current = next;
        continue;
      }
      if (!response.ok) return { ok: false, error: `Import failed (${response.status})` };
      const length = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > PRESET_IMPORT_MAX_BYTES) {
        return { ok: false, error: 'Import is too large' };
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).length > PRESET_IMPORT_MAX_BYTES) {
        return { ok: false, error: 'Import is too large' };
      }
      return parsePresetImportBody(text);
    }
    return { ok: false, error: 'Import redirected too many times' };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: 'Import timed out' };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
