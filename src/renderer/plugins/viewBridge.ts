import { useSyncExternalStore } from 'react';

export type ViewReply =
  | { id: string | number; ok: true; value: unknown }
  | {
      id: string | number;
      ok: false;
      error: string;
    };

/** 侧栏页面经 MessagePort 发来的 { id, method, args }，转成插件 renderer.call；坏消息返回 null */
export function createViewBridge(
  call: (method: string, args: unknown) => Promise<unknown>
): (data: unknown) => Promise<ViewReply | null> {
  return async (data) => {
    if (typeof data !== 'object' || data === null) return null;
    const { id, method, args } = data as Record<string, unknown>;
    if (typeof id !== 'string' && typeof id !== 'number') return null;
    if (typeof method !== 'string' || method.length === 0 || method.length > 128) return null;
    try {
      return { id, ok: true, value: await call(method, args ?? null) };
    } catch (error) {
      return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

export function decodeUtf8Base64(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

export interface PluginViewRef {
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  entry: string;
}

let views: PluginViewRef[] = [];
const listeners = new Set<() => void>();

/** 已启用插件声明的侧栏页面，由 PluginUiHost 随插件列表刷新 */
export function setPluginViews(next: PluginViewRef[]): void {
  views = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => views;

export function usePluginViews(): PluginViewRef[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
