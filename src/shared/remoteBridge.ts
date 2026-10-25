/**
 * 远程桌面：浏览器壳页面（packages/phone desk）与 iframe 里桌面 renderer 之间的同源桥。
 * 壳持有加密隧道；renderer 的 web-preload 经 `window.parent.__ensoRemote` 调用。
 */

export type RemoteFrameKind = 'main' | 'settings';

/**
 * 跨 iframe 只传 JSON 字符串（encodeRemoteValue 之后的值）：对象若直接跨 realm 传递，
 * renderer 里 instanceof Array/Uint8Array/Map 会失效，必须在 iframe 自己的 realm 里解码。
 */
export interface RemoteBridgeFrame {
  invoke(channel: string, payload: string): Promise<string>;
  send(channel: string, payload: string): void;
  on(channel: string, listener: (payload: string) => void): () => void;
  /** renderer 帧卸载 */
  close(): void;
}

export interface RemoteBridge {
  /** 宿主平台（快捷键、路径展示随宿主） */
  platform: string;
  attach(kind: RemoteFrameKind): RemoteBridgeFrame;
  leader(): boolean;
  openSettings(link?: unknown): void;
  closeSettings(): void;
  /** 设置页打开时带来的 deep link，读后即清 */
  consumeSettingsLink(): unknown;
  /** 离开桌面模式回手机版 */
  exitDesk(): void;
}

/** web-preload 额外挂到 window.electronAPI.remote；桌面 preload 不提供 */
export interface RemoteApi {
  isLeader(): boolean;
  onLeaderChanged(callback: (leader: boolean) => void): () => void;
  /** 浏览器文件落到宿主临时目录，返回宿主绝对路径 */
  upload(file: File): Promise<string | null>;
  /** 本地图片 URL 前缀：`local-image://…` 在浏览器里改走壳的 SW 代理 */
  localImagePrefix: string;
  exitDesk(): void;
}
