import { describe, expect, it } from 'vitest';
import { voiceNotePlacement } from './voiceNotePlacement';

describe('voiceNotePlacement', () => {
  const viewport = { width: 1200, height: 800 };

  it('sits just above the button, starting at its left edge', () => {
    expect(voiceNotePlacement({ left: 300, top: 700 }, viewport)).toEqual({
      left: 300,
      bottom: 106,
      maxWidth: 448,
    });
  });

  it('follows the button when the window is resized', () => {
    const before = voiceNotePlacement({ left: 300, top: 700 }, viewport);
    const after = voiceNotePlacement({ left: 180, top: 520 }, { width: 900, height: 620 });
    expect(after).not.toEqual(before);
    expect(after).toEqual({ left: 180, bottom: 106, maxWidth: 448 });
  });

  it('stays inside a narrow viewport', () => {
    expect(voiceNotePlacement({ left: 350, top: 700 }, { width: 400, height: 800 })).toEqual({
      left: 72,
      bottom: 106,
      maxWidth: 320,
    });
  });
});
