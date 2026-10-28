import { isSystemPromptId } from './systemPromptId';

/** Preset 外置正文引用：角色 / 真尾 / boost / 拒答补发，都走 system-prompts/<uuid>.md */
export const PRESET_PROMPT_ID_KEYS = [
  'systemPromptId',
  'systemPromptTailId',
  'boostPromptId',
  'refusalRetryPromptId',
] as const;

export type PresetPromptIdKey = (typeof PRESET_PROMPT_ID_KEYS)[number];

export function collectPresetPromptIds(preset: unknown): string[] {
  if (!preset || typeof preset !== 'object') return [];
  const record = preset as Record<string, unknown>;
  const ids: string[] = [];
  for (const key of PRESET_PROMPT_ID_KEYS) {
    const id = record[key];
    if (typeof id === 'string' && isSystemPromptId(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
