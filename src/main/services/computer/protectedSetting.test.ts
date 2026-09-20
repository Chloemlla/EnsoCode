import { describe, expect, it } from 'vitest';
import { isProtectedAuthText } from './protectedSetting';

describe('isProtectedAuthText', () => {
  it('认出系统鉴权框，不把锁屏页的「密码」当鉴权', () => {
    expect(isProtectedAuthText('锁屏正在尝试修改系统设置')).toBe(true);
    expect(isProtectedAuthText('Touch ID or enter password to allow this')).toBe(true);
    expect(isProtectedAuthText('不活跃时关闭显示器、锁屏\n需要密码\n触控 ID')).toBe(false);
  });
});
