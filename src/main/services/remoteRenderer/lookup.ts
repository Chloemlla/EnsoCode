import { type WebContents, webContents } from 'electron';
import { remoteSenderById } from './senders';

/** webContents.fromId 的远端感知版：远程浏览器 renderer 以伪 WebContents 返回 */
export function webContentsOrRemote(id: number): WebContents | undefined {
  const remote = remoteSenderById(id);
  if (remote) return remote as unknown as WebContents;
  return webContents.fromId(id) ?? undefined;
}
