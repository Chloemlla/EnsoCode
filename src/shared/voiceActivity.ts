import { SPEECH_SAMPLE_RATE } from './types/speech';

/** 累计出声这么久才算开口，咳嗽、按键声不触发 */
export const MIN_SPEECH_MS = 300;
/** 高出底噪这么多、且不低于绝对下限才算人声 */
const SPEECH_OVER_FLOOR_DB = 12;
const MIN_SPEECH_DB = -50;
/** 底噪取近期最小响度，随环境变吵缓慢上浮 */
const FLOOR_RISE_DB_PER_S = 3;

/** 一块音频的 RMS 响度（dBFS），全静音记 -100 */
export function decibels(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / Math.max(1, data.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/** 依次喂 16kHz 音频块，判断每块是不是人声 */
export function createVoiceActivity(): (samples: Float32Array) => boolean {
  let floor = Number.POSITIVE_INFINITY;
  return (samples) => {
    const ms = (samples.length / SPEECH_SAMPLE_RATE) * 1000;
    const db = decibels(samples);
    floor = Math.min(db, floor + (FLOOR_RISE_DB_PER_S * ms) / 1000);
    return db > Math.max(floor + SPEECH_OVER_FLOOR_DB, MIN_SPEECH_DB);
  };
}
