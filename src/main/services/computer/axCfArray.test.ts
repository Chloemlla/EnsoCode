import { describe, expect, it, vi } from 'vitest';
import { isLikelyCfPointer, splitUniqueRefs, takeOwnedRefs } from './axCfArray';

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

describe('splitUniqueRefs', () => {
  it('同一 AX 元素每次拷贝都是新指针，必须按 CFEqual 去重而非 JS 身份', () => {
    const win = { id: 'win' };
    const winAgain = { id: 'win' };
    const bar = { id: 'bar' };
    const { unique, duplicates } = splitUniqueRefs([win, bar, winAgain], (a, b) => a.id === b.id);
    expect(unique).toEqual([win, bar]);
    expect(unique[0]).toBe(win);
    expect(duplicates).toEqual([winAgain]);
    expect(duplicates[0]).toBe(winAgain);
  });
});
