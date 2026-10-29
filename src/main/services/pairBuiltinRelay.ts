import { normalizeRelayUrl } from '@enso/pair';

/**
 * 无界面宿主自带中继时：配对链接与设备记录用对外地址（反代后的 https），
 * 宿主自己直接拨本机端口，不绕反代、不依赖回环 NAT。
 */
let builtin: { publicUrl: string; localUrl: string } | null = null;

export function setBuiltinRelay(publicUrl: string, localUrl: string): void {
  builtin = { publicUrl: normalizeRelayUrl(publicUrl), localUrl: normalizeRelayUrl(localUrl) };
}

export const builtinRelayUrl = (): string | null => builtin?.publicUrl ?? null;

export function dialRelayUrl(url: string): string {
  return builtin && normalizeRelayUrl(url) === builtin.publicUrl ? builtin.localUrl : url;
}

export function publicRelayUrl(url: string): string {
  return builtin && normalizeRelayUrl(url) === builtin.localUrl ? builtin.publicUrl : url;
}
