import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (snapshot: unknown) => void;

function snapshot(revision: number) {
  return {
    revision,
    generatedAt: 1_700_000_000_000 + revision,
    providers: [
      {
        key: 'google-antigravity',
        kind: 'oauth',
        label: 'Google Antigravity',
        models: [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }],
      },
    ],
  };
}

function installApi(
  api:
    | {
        get: () => Promise<unknown>;
        onChanged: (cb: Listener) => () => void;
      }
    | undefined
): void {
  vi.stubGlobal('window', {
    electronAPI: api ? { modelDirectory: api } : {},
  });
}

async function loadStore() {
  vi.resetModules();
  return import('./index');
}

describe('model directory store', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the initial snapshot and applies a newer push', async () => {
    let listener: Listener | undefined;
    const get = vi.fn(async () => snapshot(1));
    installApi({
      get,
      onChanged: (cb) => {
        listener = cb;
        return () => {};
      },
    });
    const { bootstrapModelDirectory, useModelDirectoryStore } = await loadStore();

    bootstrapModelDirectory();
    await vi.waitFor(() => expect(useModelDirectoryStore.getState().snapshot?.revision).toBe(1));
    expect(get).toHaveBeenCalledOnce();

    listener?.(snapshot(2));
    expect(useModelDirectoryStore.getState().snapshot).toEqual(snapshot(2));
  });

  it('discards a late older revision from onChanged and from a slow get', async () => {
    let listener: Listener | undefined;
    let resolveGet: (value: unknown) => void = () => {};
    const pending = new Promise<unknown>((resolve) => {
      resolveGet = resolve;
    });
    const get = vi.fn(() => pending);
    installApi({
      get,
      onChanged: (cb) => {
        listener = cb;
        return () => {};
      },
    });
    const { bootstrapModelDirectory, useModelDirectoryStore } = await loadStore();

    bootstrapModelDirectory();
    expect(listener).toBeTypeOf('function');
    listener?.(snapshot(3));
    expect(useModelDirectoryStore.getState().snapshot?.revision).toBe(3);

    listener?.(snapshot(2));
    listener?.(snapshot(3));
    resolveGet(snapshot(1));
    await pending;
    expect(useModelDirectoryStore.getState().snapshot).toEqual(snapshot(3));
  });

  it('rejects dirty payloads without clearing a valid snapshot', async () => {
    let listener: Listener | undefined;
    installApi({
      get: vi.fn(async () => ({ revision: 'nope' })),
      onChanged: (cb) => {
        listener = cb;
        return () => {};
      },
    });
    const { bootstrapModelDirectory, useModelDirectoryStore } = await loadStore();

    bootstrapModelDirectory();
    await vi.waitFor(() => expect(listener).toBeTypeOf('function'));
    await Promise.resolve();
    expect(useModelDirectoryStore.getState().snapshot).toBeUndefined();

    listener?.(null);
    listener?.({ revision: 2, generatedAt: 1, providers: 'nope' });
    expect(useModelDirectoryStore.getState().snapshot).toBeUndefined();

    listener?.(snapshot(4));
    listener?.({ revision: 9 });
    expect(useModelDirectoryStore.getState().snapshot).toEqual(snapshot(4));
  });

  it('degrades silently when the preload export is missing', async () => {
    installApi(undefined);
    const { bootstrapModelDirectory, useModelDirectoryStore } = await loadStore();

    expect(() => {
      bootstrapModelDirectory();
      bootstrapModelDirectory();
    }).not.toThrow();
    expect(useModelDirectoryStore.getState().snapshot).toBeUndefined();
  });

  it('subscribes only once', async () => {
    let subscriptions = 0;
    installApi({
      get: vi.fn(async () => snapshot(1)),
      onChanged: () => {
        subscriptions += 1;
        return () => {};
      },
    });
    const { bootstrapModelDirectory } = await loadStore();

    bootstrapModelDirectory();
    bootstrapModelDirectory();
    expect(subscriptions).toBe(1);
  });
});
