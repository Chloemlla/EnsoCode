import {
  applyConversationsPatch,
  type ConversationsPatch,
  diffConversations,
  isEmptyConversationsPatch,
} from '@shared/conversationsPatch';
import { IPC_CHANNELS } from '@shared/types';
import type { BrowserWindow } from 'electron';
import { getWindowWebContents, sendToWindow } from '../../windows/createAppWindow';
import { remoteSenders } from './senders';

export const CONVERSATIONS_KEY = 'enso-conversations';

/** 由 MainWindow 注入，避免 settings → MainWindow 的重依赖链 */
let getMainWindow: () => BrowserWindow | null = () => null;
export function setConversationsMainWindowGetter(getter: () => BrowserWindow | null): void {
  getMainWindow = getter;
}

/** 每个主界面 renderer 最近一次读到/写入的 enso-conversations（即它认为的磁盘状态） */
const baselines = new Map<number, unknown>();
const watched = new WeakSet<object>();

interface Peer {
  id: number;
  send(patch: ConversationsPatch): void;
}

function mainPeers(): Peer[] {
  const peers: Peer[] = [];
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    const contents = getWindowWebContents(win);
    if (!contents.isDestroyed()) {
      peers.push({
        id: contents.id,
        send: (patch) => sendToWindow(win, IPC_CHANNELS.CONVERSATIONS_PATCH, patch),
      });
    }
  }
  for (const sender of remoteSenders()) {
    if (sender.kind !== 'main') continue;
    peers.push({
      id: sender.id,
      send: (patch) => sender.send(IPC_CHANNELS.CONVERSATIONS_PATCH, patch),
    });
  }
  return peers;
}

type SenderLike = { id: number; once?: (event: 'destroyed', listener: () => void) => unknown };

function track(sender: SenderLike): void {
  if (watched.has(sender) || typeof sender.once !== 'function') return;
  watched.add(sender);
  sender.once('destroyed', () => baselines.delete(sender.id));
}

export function noteConversationsRead(sender: SenderLike, value: unknown): void {
  if (baselines.has(sender.id)) return;
  track(sender);
  baselines.set(sender.id, value);
}

/**
 * 单个主界面时整份覆盖（与原行为一致）；多个主界面并存时按发送方基线求补丁、
 * 合并进磁盘并推给其他主界面，同时推进它们的基线，回写时 diff 为空不会乒乓。
 */
export function mergeConversationsWrite(
  sender: SenderLike,
  current: unknown,
  value: unknown
): unknown {
  track(sender);
  const previous = baselines.has(sender.id) ? baselines.get(sender.id) : current;
  baselines.set(sender.id, value);
  const peers = mainPeers().filter((peer) => peer.id !== sender.id);
  if (peers.length === 0 || value === undefined) return value;
  const patch = diffConversations(previous, value);
  if (isEmptyConversationsPatch(patch)) return current ?? value;
  for (const peer of peers) {
    baselines.set(
      peer.id,
      applyConversationsPatch(baselines.has(peer.id) ? baselines.get(peer.id) : current, patch)
    );
    peer.send(patch);
  }
  return applyConversationsPatch(current, patch);
}
