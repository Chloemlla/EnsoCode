import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDownsampler,
  createSpeechEndDetector,
  ensureMicPermission,
  LIVE_TIMEOUT_MS,
  levelFromSamples,
  SPEECH_END_SILENCE_MS,
  startVoiceRecording,
} from './voiceCapture';

function feed(input: Float32Array, rate: number, sizes: number[]): number[] {
  const downsample = createDownsampler(rate);
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; offset < input.length; i++) {
    const size = sizes[i % sizes.length];
    out.push(...downsample(input.subarray(offset, offset + size)));
    offset += size;
  }
  return out;
}

describe('createDownsampler', () => {
  it('passes 16kHz chunks through untouched', () => {
    const chunk = Float32Array.from([0.1, -0.2, 0.3]);
    expect(createDownsampler(16_000)(chunk)).toBe(chunk);
  });

  it('averages each output window so 48kHz shrinks to a third', () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]);
    expect(feed(input, 48_000, [9])).toEqual([expect.closeTo(0.3, 5), 1, -1]);
  });

  it('carries windows across chunk boundaries without losing or duplicating samples', () => {
    const input = Float32Array.from({ length: 4_410 }, (_, i) => Math.sin(i / 7));
    const whole = feed(input, 44_100, [input.length]);
    expect(whole.length).toBe(1_600);
    const ragged = feed(input, 44_100, [1, 4096, 13, 250]);
    expect(ragged.length).toBe(whole.length);
    for (const [i, sample] of ragged.entries()) expect(sample).toBeCloseTo(whole[i], 6);
  });

  it('keeps a constant signal constant at non-integer ratios', () => {
    const out = feed(new Float32Array(44_100).fill(0.5), 44_100, [4096]);
    expect(out.length).toBe(16_000);
    expect(out.every((sample) => Math.abs(sample - 0.5) < 1e-6)).toBe(true);
  });
});

describe('levelFromSamples', () => {
  it('is 0 for silence and 1 for a full-scale signal', () => {
    expect(levelFromSamples(new Float32Array(1024))).toBe(0);
    expect(levelFromSamples(new Float32Array(0))).toBe(0);
    expect(levelFromSamples(new Float32Array(1024).fill(1))).toBe(1);
  });

  it('keeps background noise low and normal speech clearly visible', () => {
    const noise = levelFromSamples(new Float32Array(1024).fill(0.002));
    const speech = levelFromSamples(new Float32Array(1024).fill(0.08));
    expect(noise).toBeLessThan(0.1);
    expect(speech).toBeGreaterThan(0.6);
    expect(speech).toBeLessThan(1);
  });

  it('grows with loudness', () => {
    const levels = [0.005, 0.02, 0.1].map((v) => levelFromSamples(new Float32Array(512).fill(v)));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(3);
  });
});

/** 100ms 一块的 16kHz 音频，恒定幅度即恒定响度 */
function chunks(ms: number, amplitude: number): Float32Array[] {
  return Array.from({ length: ms / 100 }, () => new Float32Array(1_600).fill(amplitude));
}

/** 喂完返回第几毫秒判定说完，没判定为 null */
function endAt(detect: (samples: Float32Array) => boolean, audio: Float32Array[]): number | null {
  for (const [i, chunk] of audio.entries()) if (detect(chunk)) return (i + 1) * 100;
  return null;
}

describe('createSpeechEndDetector', () => {
  const SPEECH = 0.08;
  const NOISE = 0.002;

  it('never ends before anything was said', () => {
    expect(endAt(createSpeechEndDetector(), chunks(10_000, 0))).toBeNull();
    expect(endAt(createSpeechEndDetector(), chunks(10_000, NOISE))).toBeNull();
  });

  it('ends once the pause after speech reaches the silence window', () => {
    const audio = [...chunks(500, NOISE), ...chunks(1_500, SPEECH), ...chunks(5_000, NOISE)];
    expect(endAt(createSpeechEndDetector(), audio)).toBe(2_000 + SPEECH_END_SILENCE_MS);
  });

  it('keeps listening through shorter pauses between phrases', () => {
    const audio = [
      ...chunks(1_000, SPEECH),
      ...chunks(SPEECH_END_SILENCE_MS - 300, 0),
      ...chunks(1_000, SPEECH),
      ...chunks(5_000, 0),
    ];
    expect(endAt(createSpeechEndDetector(), audio)).toBe(
      2_000 + SPEECH_END_SILENCE_MS - 300 + SPEECH_END_SILENCE_MS
    );
  });

  it('ignores a brief click', () => {
    expect(
      endAt(createSpeechEndDetector(), [...chunks(100, SPEECH), ...chunks(5_000, 0)])
    ).toBeNull();
  });

  it('treats steady background noise as silence and speech above it as speech', () => {
    const LOUD_ROOM = 0.02;
    const audio = [...chunks(1_000, LOUD_ROOM), ...chunks(1_000, 0.2), ...chunks(5_000, LOUD_ROOM)];
    expect(endAt(createSpeechEndDetector(), audio)).toBe(2_000 + SPEECH_END_SILENCE_MS);
  });
});

describe('ensureMicPermission', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubMic(state: PermissionState | 'unsupported', grant: 'allow' | 'deny' = 'allow') {
    const stopped: string[] = [];
    const getUserMedia = vi.fn(async () => {
      if (grant === 'deny') throw new DOMException('denied', 'NotAllowedError');
      return { getTracks: () => [{ stop: () => stopped.push('mic') }] };
    });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
      permissions: state === 'unsupported' ? undefined : { query: vi.fn(async () => ({ state })) },
    });
    return { getUserMedia, stopped };
  }

  it('does not touch the microphone when access is already granted', async () => {
    const { getUserMedia } = stubMic('granted');
    await ensureMicPermission();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('asks once and releases the microphone right away', async () => {
    for (const state of ['prompt', 'unsupported'] as const) {
      const { getUserMedia, stopped } = stubMic(state);
      await ensureMicPermission();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(stopped).toEqual(['mic']);
    }
  });

  it('passes a refusal through', async () => {
    stubMic('prompt', 'deny');
    await expect(ensureMicPermission()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

describe('startVoiceRecording live', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function fakeCapture() {
    let process: ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null =
      null;
    const processor = {
      set onaudioprocess(fn: typeof process) {
        process = fn;
      },
      get onaudioprocess() {
        return process;
      },
      connect: () => {},
      disconnect: () => {},
    };
    const context = {
      sampleRate: 16_000,
      destination: {},
      resume: async () => {},
      createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
      createScriptProcessor: () => processor,
    } as unknown as AudioContext;
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
    });
    const emit = (value: number) =>
      process?.({ inputBuffer: { getChannelData: () => new Float32Array(256).fill(value) } });
    return { context, emit };
  }

  async function settled(promise: Promise<void>): Promise<boolean> {
    let done = false;
    void promise.then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    return done;
  }

  it('waits for the first non-silent audio, not for getUserMedia', async () => {
    const { context, emit } = fakeCapture();
    const recording = await startVoiceRecording(() => {}, { context });
    emit(0);
    expect(await settled(recording.live)).toBe(false);
    emit(0.01);
    expect(await settled(recording.live)).toBe(true);
    recording.cancel();
  });

  it('settles when cancelled before the microphone comes alive', async () => {
    const { context } = fakeCapture();
    const recording = await startVoiceRecording(() => {}, { context });
    recording.cancel();
    expect(await settled(recording.live)).toBe(true);
  });

  function stubMicrophone(failure: (audio: MediaTrackConstraints) => string | null) {
    const asked: MediaTrackConstraints[] = [];
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async ({ audio }: MediaStreamConstraints) => {
          asked.push(audio as MediaTrackConstraints);
          const name = failure(audio as MediaTrackConstraints);
          if (name) throw new DOMException('cannot open', name);
          return { getTracks: () => [{ stop: () => {} }] };
        },
      },
    });
    return asked;
  }

  it('records from the chosen microphone and follows the system otherwise', async () => {
    const { context } = fakeCapture();
    const asked = stubMicrophone(() => null);
    for (const deviceId of ['usb-mic', 'default', undefined]) {
      (await startVoiceRecording(() => {}, { context, deviceId })).cancel();
    }
    expect(asked.map((audio) => audio.deviceId)).toEqual([
      { exact: 'usb-mic' },
      undefined,
      undefined,
    ]);
  });

  it('falls back to the system microphone when the chosen one is gone, not when access is denied', async () => {
    const { context } = fakeCapture();
    const gone = stubMicrophone((audio) => (audio.deviceId ? 'OverconstrainedError' : null));
    (await startVoiceRecording(() => {}, { context, deviceId: 'usb-mic' })).cancel();
    expect(gone.map((audio) => audio.deviceId)).toEqual([{ exact: 'usb-mic' }, undefined]);

    const denied = stubMicrophone(() => 'NotAllowedError');
    await expect(
      startVoiceRecording(() => {}, { context, deviceId: 'usb-mic' })
    ).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(denied).toHaveLength(1);
  });

  it('gives up waiting after a while so the UI never sticks', async () => {
    vi.useFakeTimers();
    const { context, emit } = fakeCapture();
    const recording = await startVoiceRecording(() => {}, { context });
    emit(0);
    await vi.advanceTimersByTimeAsync(LIVE_TIMEOUT_MS - 1);
    expect(await settled(recording.live)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(recording.live)).toBe(true);
    recording.cancel();
  });
});
