import { describe, expect, it } from 'vitest';
import {
  findCapturerWindowSource,
  isListedCgWindowLayer,
  thumbnailCropForWindow,
} from './windowSource';

describe('isListedCgWindowLayer', () => {
  it('普通窗和 modal sheet 列出，菜单栏不列', () => {
    expect(isListedCgWindowLayer(0)).toBe(true);
    expect(isListedCgWindowLayer(3)).toBe(true);
    expect(isListedCgWindowLayer(8)).toBe(true);
    expect(isListedCgWindowLayer(25)).toBe(false);
  });
});

describe('findCapturerWindowSource', () => {
  it('CG 窗口号能对上 Electron source id', () => {
    const sources = [{ id: 'window:88:0' }, { id: 'window:17519:0' }];
    expect(findCapturerWindowSource(sources, '17519')?.id).toBe('window:17519:0');
    expect(findCapturerWindowSource(sources, '9')).toBeUndefined();
  });
});

describe('thumbnailCropForWindow', () => {
  it('把窗口矩形映到桌面缩略图像素', () => {
    expect(
      thumbnailCropForWindow({
        window: { x: 100, y: 50, width: 200, height: 80 },
        display: { x: 0, y: 0, width: 1000, height: 500 },
        thumbnailWidth: 100,
        thumbnailHeight: 50,
      })
    ).toEqual({ x: 10, y: 5, width: 20, height: 8 });
  });
});
