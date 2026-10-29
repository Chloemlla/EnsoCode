import { readSettings } from '../ipc/settings';

/** 缺省 true：只为主 agent 弹完成/失败通知 */
export function readNotifyMainAgentOnly(): boolean {
  const state = (
    readSettings()?.['enso-settings'] as { state?: { notifyMainAgentOnly?: boolean } } | undefined
  )?.state;
  return state?.notifyMainAgentOnly !== false;
}
