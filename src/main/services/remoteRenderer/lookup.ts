import type { RendererContents } from '@platform';
import { localUi } from '../uiHost';
import { remoteSenderById } from './senders';

/** 本地窗口与远程浏览器 renderer 统一按 id 查找 */
export function webContentsOrRemote(id: number): RendererContents | undefined {
  const remote = remoteSenderById(id);
  if (remote) return remote;
  return localUi()
    ?.allContents()
    .find((contents) => contents.id === id);
}
