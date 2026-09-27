import { fromBase64Url, toBase64Url } from './encoding';

/** 每块原始 PCM 上限：384KB，base64 后约 512KB，留足中继 1MB 帧的加密/JSON 余量 */
export const VOICE_CHUNK_MAX_SAMPLES = 192_000;
export const VOICE_CHUNK_MAX_CHARS = 600_000;
/** 手机约 200ms 一块，300 秒约 1500 块，留余量 */
export const VOICE_CHUNK_MAX_INDEX = 4000;

/** Float32 PCM → 若干块小端 Int16 base64url */
export function encodeVoiceChunks(
  audio: Float32Array,
  samplesPerChunk = VOICE_CHUNK_MAX_SAMPLES
): string[] {
  const out: string[] = [];
  for (let start = 0; start < audio.length; start += samplesPerChunk) {
    const end = Math.min(audio.length, start + samplesPerChunk);
    const bytes = new Uint8Array((end - start) * 2);
    const view = new DataView(bytes.buffer);
    for (let i = start; i < end; i++) {
      const s = Math.max(-1, Math.min(1, audio[i] || 0));
      view.setInt16((i - start) * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
    }
    out.push(toBase64Url(bytes));
  }
  return out;
}

export function decodeVoiceChunk(data: string): Int16Array | null {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(data);
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length % 2 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}
