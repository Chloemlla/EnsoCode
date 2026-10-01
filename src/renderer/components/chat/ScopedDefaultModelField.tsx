import type { DefaultModelRef } from '@shared/defaultModel';
import type { ThinkingLevel } from '@shared/types';
import { findVirtualModel } from '@shared/virtualModels';
import { useMemo } from 'react';
import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { useI18n } from '@/i18n';
import { Z_INDEX } from '@/lib/z-index';
import {
  usableProvidersForOauthSnapshot,
  useOauthCredentialStore,
} from '@/stores/oauthCredentials';
import { useSettingsStore } from '@/stores/settings';

export function ScopedDefaultModelField({
  value,
  reasoningEnabled,
  thinkingLevel,
  onChange,
  onReasoningChange,
  onThinkingChange,
  description,
  inheritLabel,
}: {
  value: DefaultModelRef | null;
  reasoningEnabled: boolean;
  thinkingLevel: ThinkingLevel;
  onChange: (model: DefaultModelRef | null) => void;
  onReasoningChange: (enabled: boolean) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  description: string;
  inheritLabel: string;
}) {
  const { t } = useI18n();
  const providers = useSettingsStore((state) => state.providers);
  const virtualModels = useSettingsStore((state) => state.virtualModels);
  const snapshot = useOauthCredentialStore((state) => state.snapshot);
  const candidates = useMemo(
    () => usableProvidersForOauthSnapshot(providers, snapshot),
    [providers, snapshot]
  );
  const selectedProvider = value
    ? candidates.find((entry) => entry.id === value.providerId)
    : undefined;
  const selectedModel = selectedProvider?.models.find((entry) => entry.id === value?.modelId);
  const selectedVirtual = findVirtualModel(virtualModels, value);

  return (
    <Field className="w-full items-stretch">
      <FieldLabel>{t('Default model')}</FieldLabel>
      <FieldDescription>{description}</FieldDescription>
      {candidates.length > 0 && (
        <div className="w-full min-w-0">
          <ModelPicker
            providers={candidates}
            virtualModels={virtualModels}
            providerId={selectedVirtual ? (value?.providerId ?? '') : (selectedProvider?.id ?? '')}
            modelId={selectedVirtual ? selectedVirtual.id : (selectedModel?.id ?? '')}
            reasoningEnabled={reasoningEnabled}
            thinkingLevel={thinkingLevel}
            emptyLabel={inheritLabel}
            side="bottom"
            triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
            zIndex={Z_INDEX.DROPDOWN_IN_MODAL}
            onSelect={(providerId, modelId) => onChange({ providerId, modelId })}
            onReasoningChange={onReasoningChange}
            onThinkingChange={onThinkingChange}
          />
        </div>
      )}
      {value && !selectedVirtual && (!selectedProvider || !selectedModel) && (
        <p className="text-muted-foreground text-xs">
          {t('Selected model is unavailable — falls back to the default model.')}
        </p>
      )}
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onChange(null)}
        >
          {t('Follow default model')}
        </Button>
      )}
    </Field>
  );
}
