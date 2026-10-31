import { useEffect, useState, useSyncExternalStore } from 'react';

export interface PluginTriggerItem {
  id: string;
  label: string;
  detail?: string;
}

export interface PluginCandidate {
  key: string;
  pluginId: string;
  name: string;
  item: PluginTriggerItem;
}

interface PluginTriggerRef {
  pluginId: string;
  name: string;
}

const MAX_CANDIDATES = 50;
const MAX_LABEL = 64;
const MAX_DETAIL = 120;
const MAX_PICK_CHARS = 32 * 1024;
const DEBOUNCE_MS = 120;
const EMPTY: PluginCandidate[] = [];

/** 光标前文本里词首的 #query；没有活动 token 返回 null */
export function extractTriggerQuery(before: string): string | null {
  return /(?:^|\s)#([^\s#]*)$/.exec(before)?.[1] ?? null;
}

export function normalizeCandidates(
  pluginId: string,
  name: string,
  raw: unknown
): PluginCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginCandidate[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_CANDIDATES) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, label, detail } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof label !== 'string' || !label) continue;
    out.push({
      key: `${pluginId}:${name}:${id}`,
      pluginId,
      name,
      item: {
        id: id.slice(0, 200),
        label: label.slice(0, MAX_LABEL),
        ...(typeof detail === 'string' && detail ? { detail: detail.slice(0, MAX_DETAIL) } : {}),
      },
    });
  }
  return out;
}

export function normalizePick(raw: unknown): string | null {
  const text =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'object' && raw !== null
        ? (raw as { text?: unknown }).text
        : null;
  return typeof text === 'string' && text.length <= MAX_PICK_CHARS ? text : null;
}

let triggers: PluginTriggerRef[] = [];
const listeners = new Set<() => void>();

/** 已启用插件声明的 # 补全来源，由 PluginUiHost 随插件列表刷新 */
export function setPluginTriggers(next: PluginTriggerRef[]): void {
  triggers = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => triggers;

/** 按 query 向各插件要候选；防抖，过期结果丢弃 */
export function usePluginTriggerCandidates(
  query: string | null,
  sessionId: string | null
): PluginCandidate[] {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [items, setItems] = useState<PluginCandidate[]>(EMPTY);
  useEffect(() => {
    if (query === null || list.length === 0) {
      setItems(EMPTY);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all(
        list.map(async ({ pluginId, name }) => {
          const res = await window.electronAPI.extensionPlugins.call({
            pluginId,
            method: 'trigger.candidates',
            payload: { name, query },
            sessionId,
          });
          return res.ok ? normalizeCandidates(pluginId, name, res.value) : EMPTY;
        })
      ).then((groups) => {
        if (!cancelled) setItems(groups.flat().slice(0, MAX_CANDIDATES));
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, list, sessionId]);
  return query === null ? EMPTY : items;
}

export async function pickPluginCandidate(
  candidate: PluginCandidate,
  sessionId: string | null
): Promise<string | null> {
  const res = await window.electronAPI.extensionPlugins.call({
    pluginId: candidate.pluginId,
    method: 'trigger.pick',
    payload: { name: candidate.name, item: candidate.item },
    sessionId,
  });
  return res.ok ? normalizePick(res.value) : null;
}
