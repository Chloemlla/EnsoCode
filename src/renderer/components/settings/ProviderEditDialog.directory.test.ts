import type { ModelEntry, ModelProvider } from '@shared/types';
import { parseHTML } from 'linkedom';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModelDirectoryStore } from '@/stores/modelDirectory';
import { ProviderEditDialog } from './ProviderEditDialog';

const harness = vi.hoisted(() => ({ updateProvider: vi.fn(), providerId: 'account' }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({ providers: [], updateProvider: harness.updateProvider }),
    { getState: () => ({ defaultModel: { providerId: harness.providerId, modelId: 'late' } }) }
  ),
}));
vi.mock('@/stores/oauthCredentials', () => ({
  useOauthCredentialStore: (selector: (state: unknown) => unknown) =>
    selector({
      snapshot: {
        revision: 1,
        availability: { status: 'ready', authenticatedAccountKeys: new Set(['xai']) },
      },
    }),
}));
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Dialog: Wrap,
    DialogContent: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
    DialogPanel: Wrap,
    DialogFooter: Wrap,
    DialogPopup: Wrap,
  };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => createElement('button', { type: 'button', onClick, disabled }, children),
}));
vi.mock('@/components/ui/input', () => ({ Input: () => null }));
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: () => null }));
vi.mock('./ListFilterBar', () => ({
  ListFilterBar: () => null,
  useVisibleSelection: () => ({ selectedIds: [], isSelected: () => false }),
}));
vi.mock('./ProviderModelRow', () => ({
  ProviderModelRow: ({
    model,
    onToggleEnabled,
  }: {
    model: ModelEntry;
    onToggleEnabled: () => void;
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-model': model.id,
        'data-enabled': model.enabled !== false,
        onClick: onToggleEnabled,
      },
      model.label ?? model.id
    ),
}));

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  useModelDirectoryStore.setState({ snapshot: undefined });
  vi.unstubAllGlobals();
  harness.updateProvider.mockClear();
});

describe('OAuth 编辑弹窗目录晚到', () => {
  it.each([false, true])(
    '冷开后补模型，后续目录更新不覆盖开关编辑，保存保留选型引用（pool=%s）',
    async (pool) => {
      const dom = parseHTML('<html><body><div id="root"></div></body></html>');
      vi.stubGlobal('window', dom.window);
      vi.stubGlobal('document', dom.document);
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal('electronAPI', { providers: { listOauth: async () => [] } });
      useModelDirectoryStore.setState({ snapshot: undefined });
      const provider: ModelProvider = {
        id: 'account',
        name: 'Account',
        api: 'openai-completions',
        apiKey: '',
        baseUrl: '',
        enabled: true,
        oauthAccountKey: 'xai',
        models: [],
        ...(pool ? { oauthAccountPool: { accountKeys: ['xai'] } } : {}),
      };
      const container = dom.document.getElementById('root')!;
      root = createRoot(container);
      await act(async () =>
        root?.render(createElement(ProviderEditDialog, { provider, onClose: vi.fn() }))
      );
      expect(container.querySelectorAll('[data-model]')).toHaveLength(0);
      const publish = async (revision: number, models: ModelEntry[]) => {
        await act(async () =>
          useModelDirectoryStore.setState({
            snapshot: {
              revision,
              generatedAt: revision,
              providers: [{ key: 'xai', kind: 'oauth', label: 'xAI', models }],
            },
          })
        );
      };
      await publish(1, [{ id: 'first' }]);
      const first = container.querySelector<HTMLButtonElement>('[data-model="first"]');
      expect(first).not.toBeNull();
      await act(async () => first?.click());
      await publish(2, [{ id: 'first', enabled: true }, { id: 'late' }]);
      expect(container.querySelector('[data-model="first"]')?.getAttribute('data-enabled')).toBe(
        'false'
      );
      expect(container.querySelector('[data-model="late"]')).not.toBeNull();
      const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === 'Save'
      );
      await act(async () => save?.click());
      expect(harness.updateProvider).toHaveBeenCalledWith(
        'account',
        expect.objectContaining({
          models: [{ id: 'first', enabled: false }, { id: 'late' }],
        })
      );
    }
  );
});
