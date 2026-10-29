/** systemd 单元：后台常驻 = 前台 `start` 交给 systemd 守护 */
export interface ServiceUnitOptions {
  node: string;
  script: string;
  /** 系统级单元的运行用户；省略即用户级单元 */
  user?: string;
  env: Record<string, string>;
}

const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

export function serviceUnit(options: ServiceUnitOptions): string {
  const system = options.user !== undefined;
  return [
    '[Unit]',
    'Description=EnsoCode Server',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    ...(system ? [`User=${options.user}`] : []),
    `ExecStart=${quote(options.node)} ${quote(options.script)} start`,
    ...Object.entries(options.env).map(([key, value]) => `Environment="${key}=${value}"`),
    'Restart=always',
    'RestartSec=3',
    'TimeoutStopSec=30',
    '',
    '[Install]',
    `WantedBy=${system ? 'multi-user.target' : 'default.target'}`,
    '',
  ].join('\n');
}
