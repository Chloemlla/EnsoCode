import { describe, expect, it } from 'vitest';
import { resolveClickRoute } from './clickRoute';

describe('resolveClickRoute', () => {
  it('有 pid 和 windowId 时优先 sky_click', () => {
    expect(resolveClickRoute({ delivery: 'foreground', pid: 42, windowId: 9 })).toBe('skyClick');
    expect(resolveClickRoute({ delivery: 'background', pid: 42, windowId: 9 })).toBe('skyClick');
  });

  it('有 pid 时走 postToPid，不移动真实指针', () => {
    expect(resolveClickRoute({ delivery: 'foreground', pid: 42 })).toBe('postToPid');
    expect(resolveClickRoute({ delivery: 'background', pid: 42 })).toBe('postToPid');
  });

  it('前台无 pid 才退回 HID', () => {
    expect(resolveClickRoute({ delivery: 'foreground' })).toBe('hid');
  });

  it('后台无 pid 不可用，不偷偷改成 HID', () => {
    expect(resolveClickRoute({ delivery: 'background' })).toBe('unavailable');
  });
});
