import { SPEECH_SAMPLE_RATE } from '@shared/types/speech';
import { createVoiceActivity, MIN_SPEECH_MS } from '@shared/voiceActivity';

/** 开口后停顿满 1s 切一句，与流式 X-ASR 的断句规则一致；切点在静音里，句尾自带一段静音 */
const PAUSE_MS = 1_000;
const FRAME_MS = 30;
const FRAME = (SPEECH_SAMPLE_RATE * FRAME_MS) / 1000;

export function joinSamples(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export interface PauseSegmenter {
  /** 喂音频，返回这次凑满停顿的整句（多数时候为空） */
  push(samples: Float32Array): Float32Array[];
  /** 录音结束：取出剩下的音频，speech 表示其中是否出过声 */
  flush(): { samples: Float32Array; speech: boolean };
}

/** 按固定 30ms 帧判断人声，切点与推送块大小无关 */
export function createPauseSegmenter(): PauseSegmenter {
  const isSpeech = createVoiceActivity();
  let frames: Float32Array[] = [];
  let carry = new Float32Array(0);
  let spokenMs = 0;
  let quietMs = 0;
  const take = () => {
    const samples = joinSamples(frames);
    frames = [];
    spokenMs = 0;
    quietMs = 0;
    return samples;
  };
  return {
    push: (samples) => {
      const input = joinSamples([carry, samples]);
      const out: Float32Array[] = [];
      let offset = 0;
      for (; offset + FRAME <= input.length; offset += FRAME) {
        const frame = input.subarray(offset, offset + FRAME);
        frames.push(frame);
        if (isSpeech(frame)) {
          spokenMs += FRAME_MS;
          quietMs = 0;
        } else quietMs += FRAME_MS;
        if (spokenMs >= MIN_SPEECH_MS && quietMs >= PAUSE_MS) out.push(take());
      }
      carry = input.slice(offset);
      return out;
    },
    flush: () => {
      frames.push(carry);
      carry = new Float32Array(0);
      const speech = spokenMs > 0;
      return { samples: take(), speech };
    },
  };
}
