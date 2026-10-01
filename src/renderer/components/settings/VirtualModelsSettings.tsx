import type { DefaultModelRef } from '@shared/defaultModel';
import type { ModelProvider } from '@shared/types';
import {
  canBeVirtualMember,
  classifierProviderFor,
  VIRTUAL_CLASSIFIER_DEFAULT_TIMEOUT_MS,
  type VirtualModelEntry,
} from '@shared/virtualModels';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  usableProvidersForOauthSnapshot,
  useOauthCredentialStore,
} from '@/stores/oauthCredentials';
import { useSettingsStore } from '@/stores/settings';

const noop = () => undefined;
const OFF = 'off';

function MemberPicker({
  providers,
  value,
  emptyLabel,
  onSelect,
}: {
  providers: ModelProvider[];
  value: DefaultModelRef | undefined;
  emptyLabel?: string;
  onSelect: (ref: DefaultModelRef) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <ModelPicker
        providers={providers}
        providerId={value?.providerId ?? ''}
        modelId={value?.modelId ?? ''}
        reasoningEnabled={false}
        thinkingLevel="medium"
        showReasoningControls={false}
        emptyLabel={emptyLabel}
        side="bottom"
        triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
        onSelect={(providerId, modelId) => onSelect({ providerId, modelId })}
        onReasoningChange={noop}
        onThinkingChange={noop}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-start gap-2">
      <div className="pt-1.5 text-xs">
        <div>{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

function ClassifierField({
  entry,
  providers,
  classifierProviders,
  update,
}: {
  entry: VirtualModelEntry;
  providers: ModelProvider[];
  classifierProviders: ModelProvider[];
  update: (updates: Partial<Omit<VirtualModelEntry, 'id'>>) => void;
}) {
  const { t } = useI18n();
  const classifier = entry.classifier;
  const source = classifier?.source ?? OFF;
  const piProviderId = classifier?.source === 'pi-classifier' ? classifier.model.providerId : '';
  const [piModels, setPiModels] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!piProviderId) {
      setPiModels([]);
      return;
    }
    let cancelled = false;
    void window.electronAPI.providers.classifierModels(piProviderId).then((models) => {
      if (!cancelled) setPiModels(models);
    });
    return () => {
      cancelled = true;
    };
  }, [piProviderId]);
  if (!entry.fast) {
    return (
      <p className="pt-1.5 text-[11px] text-muted-foreground">{t('Set a fast model first')}</p>
    );
  }
  const fast = entry.fast;
  const setSource = (next: string) => {
    if (next === OFF) return update({ classifier: undefined });
    if (next === 'judge') {
      return update({
        classifier: {
          source: 'judge',
          model: fast,
          timeoutMs: VIRTUAL_CLASSIFIER_DEFAULT_TIMEOUT_MS,
        },
      });
    }
    const provider = classifierProviders[0];
    if (provider) {
      update({
        classifier: {
          source: 'pi-classifier',
          model: { providerId: provider.id, modelId: '' },
          timeoutMs: VIRTUAL_CLASSIFIER_DEFAULT_TIMEOUT_MS,
        },
      });
    }
  };
  const sourceItems = [
    { value: OFF, label: t('Off') },
    { value: 'judge', label: t('Fast model judges') },
    ...(classifierProviders.length > 0
      ? [{ value: 'pi-classifier', label: t('Classifier model') }]
      : []),
  ];
  return (
    <div className="space-y-1">
      <Select
        items={sourceItems}
        value={source}
        onValueChange={(value) => setSource(String(value))}
      >
        <SelectTrigger size="sm" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {sourceItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {classifier?.source === 'judge' && (
        <MemberPicker
          providers={providers}
          value={classifier.model}
          onSelect={(model) => update({ classifier: { ...classifier, model } })}
        />
      )}
      {classifier?.source === 'pi-classifier' && (
        <div className="flex gap-1">
          <Select
            items={classifierProviders.map((p) => ({ value: p.id, label: p.name }))}
            value={classifier.model.providerId}
            onValueChange={(value) =>
              update({
                classifier: { ...classifier, model: { providerId: String(value), modelId: '' } },
              })
            }
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {classifierProviders.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Select
            items={piModels.map((m) => ({ value: m.id, label: m.name }))}
            value={classifier.model.modelId || null}
            onValueChange={(value) =>
              update({
                classifier: {
                  ...classifier,
                  model: { providerId: classifier.model.providerId, modelId: String(value) },
                },
              })
            }
          >
            <SelectTrigger size="sm" className="min-w-0 flex-1">
              <SelectValue placeholder={t('Select model')} />
            </SelectTrigger>
            <SelectPopup>
              {piModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        {t(
          'Classifies each new turn: simple turns use the fast model, complex ones the primary model. Adds a short delay before the reply.'
        )}
      </p>
    </div>
  );
}

function VirtualModelCard({
  entry,
  providers,
  classifierProviders,
}: {
  entry: VirtualModelEntry;
  providers: ModelProvider[];
  classifierProviders: ModelProvider[];
}) {
  const { t } = useI18n();
  const updateEntry = useSettingsStore((state) => state.updateVirtualModel);
  const removeEntry = useSettingsStore((state) => state.removeVirtualModel);
  const used = [entry.primary, ...(entry.fast ? [entry.fast] : []), ...entry.fallbacks];
  let nextFallback: DefaultModelRef | undefined;
  for (const provider of providers) {
    const model = provider.models.find(
      (item) =>
        item.enabled !== false &&
        !used.some((ref) => ref.providerId === provider.id && ref.modelId === item.id)
    );
    if (model) {
      nextFallback = { providerId: provider.id, modelId: model.id };
      break;
    }
  }
  const update = (updates: Partial<Omit<VirtualModelEntry, 'id'>>) =>
    updateEntry(entry.id, updates);
  return (
    <div
      data-slot="virtual-model-card"
      className={cn(
        'space-y-2 rounded-md border p-2',
        !entry.enabled && 'bg-muted/50 text-muted-foreground'
      )}
    >
      <div className="flex items-center gap-2">
        <Switch
          aria-label={t('Enable virtual model')}
          checked={entry.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
        <Input
          value={entry.name}
          maxLength={60}
          placeholder="Auto"
          className="h-7 flex-1 text-xs"
          onChange={(event) => update({ name: event.target.value })}
        />
        {!entry.enabled && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
            {t('Disabled')}
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('Delete')}
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => removeEntry(entry.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Field label={t('Primary model')} hint={t('Default for each new turn')}>
        <MemberPicker
          providers={providers}
          value={entry.primary}
          onSelect={(primary) =>
            update({
              primary,
              fallbacks: entry.fallbacks.filter(
                (ref) => ref.providerId !== primary.providerId || ref.modelId !== primary.modelId
              ),
            })
          }
        />
      </Field>
      <Field label={t('Fast model')} hint={t('Summaries and simple turns')}>
        <div className="flex items-center gap-1">
          <MemberPicker
            providers={providers}
            value={entry.fast}
            emptyLabel={t('Not used')}
            onSelect={(fast) => update({ fast })}
          />
          {entry.fast && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('Clear')}
              className="h-6 w-6 shrink-0 text-muted-foreground"
              onClick={() => update({ fast: undefined })}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </Field>
      <Field
        label={t('Fallback models')}
        hint={t('Used in order when a model is rate limited or down')}
      >
        {entry.fallbacks.map((ref, index) => (
          <div key={`${ref.providerId}/${ref.modelId}`} className="flex items-center gap-1">
            <MemberPicker
              providers={providers}
              value={ref}
              onSelect={(next) =>
                update({
                  fallbacks: entry.fallbacks.map((item, at) => (at === index ? next : item)),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('Delete')}
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => update({ fallbacks: entry.fallbacks.filter((_, at) => at !== index) })}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!nextFallback || entry.fallbacks.length >= 8}
          onClick={() => {
            if (nextFallback) update({ fallbacks: [...entry.fallbacks, nextFallback] });
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('Add fallback')}
        </Button>
      </Field>
      <Field label={t('Difficulty routing')}>
        <ClassifierField
          entry={entry}
          providers={providers}
          classifierProviders={classifierProviders}
          update={update}
        />
      </Field>
    </div>
  );
}

/**
 * 虚拟模型：在模型选择器里出现为一个模型，每次请求由路由挑真实成员。
 * 成员不含 Cursor（不经 pi 请求管线）。
 */
export function VirtualModelsSettings() {
  const { t } = useI18n();
  const providers = useSettingsStore((state) => state.providers);
  const entries = useSettingsStore((state) => state.virtualModels);
  const addEntry = useSettingsStore((state) => state.addVirtualModel);
  const defaultModel = useSettingsStore((state) => state.defaultModel);
  const snapshot = useOauthCredentialStore((state) => state.snapshot);
  const usable = useMemo(
    () => usableProvidersForOauthSnapshot(providers, snapshot),
    [providers, snapshot]
  );
  const candidates = useMemo(() => usable.filter(canBeVirtualMember), [usable]);
  const classifierProviders = useMemo(
    () => usable.filter((provider) => classifierProviderFor(provider) !== undefined),
    [usable]
  );
  const seed = useMemo((): DefaultModelRef | null => {
    if (defaultModel) {
      const provider = candidates.find((entry) => entry.id === defaultModel.providerId);
      if (provider?.models.some((m) => m.id === defaultModel.modelId && m.enabled !== false)) {
        return defaultModel;
      }
    }
    for (const provider of candidates) {
      const model = provider.models.find((entry) => entry.enabled !== false);
      if (model) return { providerId: provider.id, modelId: model.id };
    }
    return null;
  }, [candidates, defaultModel]);

  return (
    <section data-slot="virtual-models" className="space-y-2 rounded-lg border bg-card p-3">
      <div>
        <h4 className="font-medium text-sm">{t('Virtual models')}</h4>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {t(
            'A virtual model appears as one model in the picker and routes each request to a real model: fallbacks on rate limits or outages, image-capable or larger-context members when needed, and the fast model for summaries.'
          )}
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          {t('Applies to newly started conversations.')}
        </p>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <VirtualModelCard
            key={entry.id}
            entry={entry}
            providers={candidates}
            classifierProviders={classifierProviders}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!seed}
          onClick={() => {
            if (seed) addEntry({ name: 'Auto', enabled: true, primary: seed, fallbacks: [] });
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('New virtual model')}
        </Button>
        {!seed && (
          <p className="text-muted-foreground text-xs">
            {t('Enable a model and configure valid provider credentials first.')}
          </p>
        )}
      </div>
    </section>
  );
}
