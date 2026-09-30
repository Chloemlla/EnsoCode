const PROTECTED_AUTH =
  /正在尝试修改系统设置|trying to modify system settings|enter password to allow|输入密码以允许|用户[帐账]户控制|user account control|windows 安全中心|windows security/i;

export function isProtectedAuthText(text: string): boolean {
  return PROTECTED_AUTH.test(text);
}

export const PROTECTED_SETTING_MESSAGE =
  'This needs Touch ID, a password, or an administrator/security prompt. Stop and ask the user to authenticate; do not click the prompt or change values.';
