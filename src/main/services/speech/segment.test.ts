import { describe, expect, it } from 'vitest';
import { createPauseSegmenter, joinSamples } from './segment';

const RATE = 16_000;
const tone = (seconds: number) =>
  Float32Array.from(
    { length: seconds * RATE },
    (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE)
  );
/** 约 -63dB 的底噪 */
const quiet = (seconds: number) =>
  Float32Array.from({ length: seconds * RATE }, (_, i) => (((i * 7919) % 13) - 6) * 0.0002);
const concat = (...parts: Float32Array[]) => joinSamples(parts);

function run(audio: Float32Array, chunk: number) {
  const segmenter = createPauseSegmenter();
  const segments: number[] = [];
  for (let i = 0; i < audio.length; i += chunk) {
    segments.push(...segmenter.push(audio.subarray(i, i + chunk)).map((s) => s.length));
  }
  const tail = segmenter.flush();
  return { segments, tail: tail.samples.length, speech: tail.speech };
}

describe('createPauseSegmenter', () => {
  it('cuts a sentence once a pause reaches one second, whatever the chunk size', () => {
    const audio = concat(quiet(0.3), tone(1), quiet(1.5), tone(0.8), quiet(0.4));
    const first = run(audio, 1_365);
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0] / RATE).toBeGreaterThanOrEqual(2.3);
    expect(first.segments[0] / RATE).toBeLessThan(2.8);
    expect(first.segments[0] + first.tail).toBe(audio.length);
    expect(first.speech).toBe(true);
    for (const chunk of [100, 4_000, RATE]) expect(run(audio, chunk)).toEqual(first);
  });

  it('cuts every sentence and keeps shorter pauses inside one', () => {
    const sentences = concat(
      quiet(0.3),
      tone(1),
      quiet(1.2),
      tone(1),
      quiet(1.2),
      tone(0.5),
      quiet(0.2)
    );
    expect(run(sentences, 1_365).segments).toHaveLength(2);
    const oneSentence = concat(quiet(0.3), tone(1), quiet(0.6), tone(1), quiet(0.3));
    expect(run(oneSentence, 1_365)).toEqual({
      segments: [],
      tail: oneSentence.length,
      speech: true,
    });
  });

  it('does not cut on a brief click and reports pure silence as no speech', () => {
    expect(run(concat(quiet(0.3), tone(0.1), quiet(2)), 1_365).segments).toEqual([]);
    expect(run(quiet(3), 1_365)).toEqual({ segments: [], tail: 3 * RATE, speech: false });
    expect(run(new Float32Array(RATE), 1_365).speech).toBe(false);
  });
});
