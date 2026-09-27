import { describe, expect, it } from 'vitest';
import { decodeVoiceChunk, encodeVoiceChunks, VOICE_CHUNK_MAX_CHARS } from './voice';

describe('语音分块编解码', () => {
  it('Float32 → Int16 小端，超界截断', () => {
    const [data] = encodeVoiceChunks(new Float32Array([0, 1, -1, 2, -2, 0.5, Number.NaN]));
    expect(Array.from(decodeVoiceChunk(data) ?? [])).toEqual([
      0, 32767, -32768, 32767, -32768, 16384, 0,
    ]);
  });

  it('按上限切块，末块可不足', () => {
    const chunks = encodeVoiceChunks(new Float32Array(10), 4);
    expect(chunks.map((c) => decodeVoiceChunk(c)?.length)).toEqual([4, 4, 2]);
  });

  it('满块 base64 长度不超过校验上限', () => {
    const [data] = encodeVoiceChunks(new Float32Array(192_000).fill(0.3));
    expect(data.length).toBeLessThanOrEqual(VOICE_CHUNK_MAX_CHARS);
    expect(decodeVoiceChunk(data)?.length).toBe(192_000);
  });

  it('空音频不出块', () => {
    expect(encodeVoiceChunks(new Float32Array(0))).toEqual([]);
  });

  it('非法 base64、奇数字节、空串返回 null', () => {
    expect(decodeVoiceChunk('')).toBeNull();
    expect(decodeVoiceChunk('AA')).toBeNull();
    expect(decodeVoiceChunk('!!!!')).toBeNull();
  });
});
