import type { TFunction } from '@/i18n';

/** 工具 id → 显示名 i18n key；只影响 UI，发给模型的工具名不变 */
export const TOOL_LABEL_KEYS: Partial<Record<string, string>> = {
  exec: 'Isolated sandbox',
  apply_patch: 'Apply patch',
  explore_mark: 'Explore mark',
  explore_fold: 'Explore fold',
  subagent: 'Subagent',
  workflow: 'Workflow',
  ask_user: 'Ask user',
  task_output: 'Task output',
  task_stop: 'Task stop',
  message_coworker: 'Message coworker',
  message_main_agent: 'Message main agent',
  enso_app: 'Enso app',
  enso_capabilities: 'Enso capabilities',
  recall: 'Recall memory',
  memory_search: 'Memory search',
  memory_capture: 'Memory capture',
  memory_crystallize: 'Memory crystallize',
  browser_navigate: 'Browser navigate',
  browser_snapshot: 'Browser snapshot',
  browser_click: 'Browser click',
  browser_type: 'Browser type',
  browser_tabs: 'Browser tabs',
  browser_lock: 'Browser lock',
  browser_fill: 'Browser fill',
  browser_press_key: 'Browser press key',
  browser_scroll: 'Browser scroll',
  browser_select_option: 'Browser select option',
  browser_mouse_click_xy: 'Browser click xy',
  browser_drag: 'Browser drag',
  browser_highlight: 'Browser highlight',
  browser_get_bounding_box: 'Browser bounding box',
  browser_screenshot: 'Browser screenshot',
  browser_cdp: 'Browser CDP',
};

export function toolLabel(name: string, t: TFunction): string {
  const key = TOOL_LABEL_KEYS[name];
  return key ? t(key) : name;
}
