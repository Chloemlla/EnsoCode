import { describe, expect, it } from 'vitest';
import { isMobileWidth, MOBILE_MAX_WIDTH } from './useViewport';

describe('isMobileWidth', () => {
  it('treats widths up to the md breakpoint as mobile', () => {
    expect(MOBILE_MAX_WIDTH).toBe(767);
    expect(isMobileWidth(375)).toBe(true);
    expect(isMobileWidth(767)).toBe(true);
  });

  it('keeps desktop widths (main window minWidth 800) non-mobile', () => {
    expect(isMobileWidth(768)).toBe(false);
    expect(isMobileWidth(800)).toBe(false);
    expect(isMobileWidth(1440)).toBe(false);
  });
});
