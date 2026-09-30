import { describe, expect, it } from 'vitest';
import { isProtectedAuthText } from './protectedSetting';

describe('isProtectedAuthText', () => {
  it('认出系统鉴权框，不把锁屏页的「密码」当鉴权', () => {
    expect(isProtectedAuthText('锁屏正在尝试修改系统设置')).toBe(true);
    expect(isProtectedAuthText('Touch ID or enter password to allow this')).toBe(true);
    expect(isProtectedAuthText('不活跃时关闭显示器、锁屏\n需要密码\n触控 ID')).toBe(false);
  });

  it('认出 Windows 的 UAC 与安全凭据窗口', () => {
    expect(isProtectedAuthText('用户帐户控制')).toBe(true);
    expect(isProtectedAuthText('User Account Control')).toBe(true);
    expect(isProtectedAuthText('consent\nWindows 安全中心')).toBe(true);
    expect(isProtectedAuthText('Windows Security')).toBe(true);
    expect(isProtectedAuthText('notepad\n无标题 - 记事本')).toBe(false);
  });
});
