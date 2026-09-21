const SETTINGS: Record<string, string> = {
  外观: 'ms-settings:colors',
  appearance: 'ms-settings:colors',
  锁屏: 'ms-settings:lockscreen',
  'lock screen': 'ms-settings:lockscreen',
  lockscreen: 'ms-settings:lockscreen',
  显示: 'ms-settings:display',
  displays: 'ms-settings:display',
};

const APPS: Array<{ names: readonly string[]; command: string }> = [
  { names: ['系统设置', 'settings', 'system settings'], command: 'ms-settings:' },
  { names: ['记事本', 'notepad'], command: 'notepad' },
  { names: ['资源管理器', 'explorer'], command: 'explorer' },
];

export function resolveWinSettingsPane(pane: string): string | undefined {
  const key = pane.trim().toLocaleLowerCase();
  return key ? (SETTINGS[key] ?? SETTINGS[pane.trim()]) : undefined;
}

export function resolveWinLaunch(name: string): { target: string; app: boolean } {
  const key = name.trim().toLocaleLowerCase();
  for (const group of APPS) {
    if (group.names.some((item) => item.toLocaleLowerCase() === key)) {
      return { target: group.command, app: !group.command.startsWith('ms-settings:') };
    }
  }
  return { target: name.trim(), app: true };
}
