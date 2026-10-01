import { describe, expect, it, vi } from 'vitest';
import { isLikelyCfPointer, takeOwnedRefs } from './axCfArray';

describe('isLikelyCfPointer', () => {
  it('拒绝空值和像 CFTypeID 的小整数', () => {
    expect(isLikelyCfPointer(null)).toBe(false);
    expect(isLikelyCfPointer(undefined)).toBe(false);
    expect(isLikelyCfPointer(0)).toBe(false);
    expect(isLikelyCfPointer(0x3ff)).toBe(false);
  });

  it('接受对象指针', () => {
    expect(isLikelyCfPointer({})).toBe(true);
  });
});

describe('takeOwnedRefs', () => {
  it('取出元素后先 retain，调用方才能安全释放数组', () => {
    const retain = vi.fn();
    const items = [{ id: 'a' }, { id: 'b' }];
    const owned = takeOwnedRefs(items.length, (i) => items[i], retain);
    expect(owned).toEqual(items);
    expect(retain).toHaveBeenCalledTimes(2);
    expect(retain).toHaveBeenNthCalledWith(1, items[0]);
    expect(retain).toHaveBeenNthCalledWith(2, items[1]);
  });
});
