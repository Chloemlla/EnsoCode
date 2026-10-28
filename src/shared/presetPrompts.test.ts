import { describe, expect, it } from 'vitest';
import { collectPresetPromptIds } from './presetPrompts';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('collectPresetPromptIds', () => {
  it('收集角色 / 真尾 / boost / 拒答正文引用并去重', () => {
    expect(
      collectPresetPromptIds({
        systemPromptId: id,
        systemPromptTailId: other,
        boostPromptId: id,
        refusalRetryPromptId: other,
      })
    ).toEqual([id, other]);
  });

  it('忽略坏 id 和非对象', () => {
    expect(collectPresetPromptIds({ systemPromptId: 'not-a-uuid' })).toEqual([]);
    expect(collectPresetPromptIds(null)).toEqual([]);
    expect(collectPresetPromptIds({ skillIds: [] })).toEqual([]);
  });
});
