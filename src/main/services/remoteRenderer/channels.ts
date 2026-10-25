import { IPC_CHANNELS } from '@shared/types';

/** 宿主原生能力或作用于宿主桌面的通道（打开窗口/对话框/定位文件/系统剪贴板等），远端一律不可调 */
const DENIED_PREFIXES = [
  'window:',
  'updater:',
  'dialog:',
  'computer:',
  'browser:',
  'nodes:',
  'config-sync:',
  'app:',
  'notification:',
  'pair:',
];

const DENIED: ReadonlySet<string> = new Set([
  IPC_CHANNELS.FILES_REVEAL,
  IPC_CHANNELS.FILES_OPEN,
  IPC_CHANNELS.FILES_OPEN_CONTEXT,
  IPC_CHANNELS.FILES_COPY_PATH,
  IPC_CHANNELS.FILES_COPY_FILE,
  IPC_CHANNELS.PROJECTS_REVEAL,
  IPC_CHANNELS.PROJECTS_OPEN_IN_APPS,
  IPC_CHANNELS.RESOURCES_STORAGE_REVEAL,
  IPC_CHANNELS.SPEECH_MIC_ACCESS,
  IPC_CHANNELS.BOT_OPEN_WORKSPACE,
  IPC_CHANNELS.BOT_ARTIFACT_OPEN,
  IPC_CHANNELS.SETTINGS_DEEP_LINK_CONSUME,
]);

/** leader renderer 才需要的宿主桥接（pair 目录推送）；其余 pair:* 属配对管理，远端不可调 */
const LEADER_ONLY: ReadonlySet<string> = new Set([IPC_CHANNELS.PAIR_CATALOG]);

export function isRemoteChannelAllowed(channel: string, leader: boolean): boolean {
  if (LEADER_ONLY.has(channel)) return leader;
  if (DENIED.has(channel)) return false;
  return !DENIED_PREFIXES.some((prefix) => channel.startsWith(prefix));
}
