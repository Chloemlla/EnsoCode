import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SettingsModule from './index';

vi.stubGlobal('navigator', { language: 'en-US' });
vi.stubGlobal('document', {
  documentElement: {
    dataset: {},
    lang: 'en',
    classList: { toggle: vi.fn() },
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
  },
});
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
  electronAPI: {
    settings: {
      read: vi.fn(async () => null),
      writeKey: vi.fn(async () => true),
      onChanged: vi.fn(),
    },
    sourceAuthority: {
      read: vi.fn(async () => ({ projects: [], conversations: [] })),
      onChanged: vi.fn(() => vi.fn()),
    },
    instructions: { delete: vi.fn(async () => ({ ok: true })) },
  },
});

let settings: typeof SettingsModule;

const entry = (key: string, enabled = true) => ({
  id: `id-${key}`,
  key,
  name: key.split('@')[0],
  description: '',
  source: 'Claude Code',
  enabled,
});

describe('plugin settings', () => {
  beforeAll(async () => {
    settings = await import('./index');
  });

  beforeEach(() => {
    settings.useSettingsStore.setState({ plugins: [] });
  });

  it('adds plugins once per key', () => {
    const store = settings.useSettingsStore.getState();
    expect(store.addPlugins([entry('a@m'), entry('b@m')])).toBe(2);
    expect(settings.useSettingsStore.getState().addPlugins([entry('a@m'), entry('c@m')])).toBe(1);
    expect(settings.useSettingsStore.getState().plugins.map((plugin) => plugin.key)).toEqual([
      'a@m',
      'b@m',
      'c@m',
    ]);
  });

  it('toggles and removes a plugin', () => {
    settings.useSettingsStore.getState().addPlugins([entry('a@m'), entry('b@m')]);
    settings.useSettingsStore.getState().setPluginEnabled('id-a@m', false);
    settings.useSettingsStore.getState().removePlugin('id-b@m');
    expect(settings.useSettingsStore.getState().plugins).toEqual([entry('a@m', false)]);
  });
});
