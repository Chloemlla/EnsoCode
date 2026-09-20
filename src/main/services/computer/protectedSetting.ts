const PROTECTED_AUTH =
  /正在尝试修改系统设置|trying to modify system settings|enter password to allow|输入密码以允许/i;

export function isProtectedAuthText(text: string): boolean {
  return PROTECTED_AUTH.test(text);
}

export const PROTECTED_SETTING_MESSAGE =
  'This setting needs Touch ID or a password. Stop and ask the user to authenticate; do not click the prompt or change values.';
