import { SPEECH_SAMPLE_RATE, SYSTEM_MICROPHONE } from '@shared/types/speech';
import { createVoiceActivity, decibels, MIN_SPEECH_MS } from '@shared/voiceActivity';

/**
 * 边录边降到 16kHz：按窗口取均值（比逐点抽取少混叠），跨块保留未凑满窗口的尾巴，
 * 任意切块结果都与整段一次处理一致。
 */
export function createDownsampler(inputRate: number): (chunk: Float32Array) => Float32Array {
  if (inputRate === SPEECH_SAMPLE_RATE) return (chunk) => chunk;
  const ratio = inputRate / SPEECH_SAMPLE_RATE;
  let pending = new Float32Array(0);
  /** pending[0] 在整段输入中的下标 */
  let base = 0;
  let produced = 0;
  return (chunk) => {
    const input = new Float32Array(pending.length + chunk.length);
    input.set(pending);
    input.set(chunk, pending.length);
    const end = base + input.length;
    const out: number[] = [];
    for (;;) {
      const from = Math.floor(produced * ratio);
      const to = Math.floor((produced + 1) * ratio);
      if (to > end) break;
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j - base];
      out.push(to > from ? sum / (to - from) : (input[from - base] ?? 0));
      produced++;
    }
    const keep = Math.floor(produced * ratio);
    pending = input.slice(keep - base);
    base = keep;
    return Float32Array.from(out);
  };
}

/** 一块音频的响度映射到 0–1，按 dB 线性：-55dB 以下算静音，-10dB 顶满 */
export function levelFromSamples(data: Float32Array): number {
  return Math.min(1, Math.max(0, (decibels(data) + 55) / 45));
}

/** 开口后停顿这么久算说完 */
export const SPEECH_END_SILENCE_MS = 2000;

/** 喂 16kHz 音频块，开口之后静音满 silenceMs 时返回 true */
export function createSpeechEndDetector(
  silenceMs = SPEECH_END_SILENCE_MS
): (samples: Float32Array) => boolean {
  const isSpeech = createVoiceActivity();
  let spokenMs = 0;
  let quietMs = 0;
  return (samples) => {
    const ms = (samples.length / SPEECH_SAMPLE_RATE) * 1000;
    if (isSpeech(samples)) {
      spokenMs += ms;
      quietMs = 0;
    } else quietMs += ms;
    return spokenMs >= MIN_SPEECH_MS && quietMs >= silenceMs;
  };
}

export class SilentRecordingError extends Error {}

let primed: AudioContext | null = null;

/**
 * 在点击手势里调用：建好并启动共享 AudioContext。
 * 按住说话从触摸按下开始录，而触摸按下不算用户激活，iOS 不许那时启动音频，只能提前备好。
 */
export function primeVoiceAudio(): AudioContext {
  if (!primed || primed.state === 'closed') primed = new AudioContext();
  if (primed.state !== 'running') void primed.resume().catch(() => {});
  return primed;
}

/**
 * 先把麦克风授权走完：已授权直接返回，否则开一下立刻关。
 * iOS 主屏 app 每次冷启动都会再问，放在按住说话中途弹窗会打断这次按住。
 */
export async function ensureMicPermission(): Promise<void> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (status?.state === 'granted') return;
  } catch {
    // 不支持按名字查麦克风（旧 Safari / Firefox）就直接申请
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

export function releaseVoiceAudio(): void {
  const context = primed;
  primed = null;
  void context?.close().catch(() => {});
}

export interface VoiceCaptureOptions {
  /** 已启动的 AudioContext（见 primeVoiceAudio），录完不关闭 */
  context?: AudioContext;
  /** 录音设备；缺省或 SYSTEM_MICROPHONE 跟随系统 */
  deviceId?: string;
  /** 每块原始音频的响度 0–1，画波形用 */
  onLevel?: (level: number) => void;
}

const CAPTURE: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** 选中的麦克风拔掉或打不开时退回系统默认；拒绝授权照常报错 */
async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  if (!deviceId || deviceId === SYSTEM_MICROPHONE) return media.getUserMedia({ audio: CAPTURE });
  try {
    return await media.getUserMedia({ audio: { ...CAPTURE, deviceId: { exact: deviceId } } });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw error;
    return media.getUserMedia({ audio: CAPTURE });
  }
}

/** 迟迟等不到真信号就不等了，交给录完时的静音检测兜底 */
export const LIVE_TIMEOUT_MS = 5000;

export interface VoiceRecording {
  /**
   * 第一块非静音音频到达时落定：iOS 的 getUserMedia 返回后麦克风还要一两秒才真正出声，
   * 此前说的话收不到。超时或停止也会落定。
   */
  live: Promise<void>;
  /** 停止采集；全程无信号（常见于系统拒绝授权）抛 SilentRecordingError */
  stop(): Promise<void>;
  cancel(): void;
}

/** 不传 context 时须在用户手势内调用：iOS 只允许手势里启动 AudioContext。onChunk 收 16kHz 单声道 PCM */
export async function startVoiceRecording(
  onChunk: (samples: Float32Array) => void,
  options: VoiceCaptureOptions = {}
): Promise<VoiceRecording> {
  const owned = !options.context;
  // 先同步建并 resume：等完 getUserMedia 再建，iOS 会判定手势已过期而一直 suspended
  const context = options.context ?? new AudioContext();
  const resumed = context.resume();
  let stream: MediaStream | undefined;
  try {
    stream = await openMicrophone(options.deviceId);
    // 没有用户激活时 resume 永不落定（Chrome 自动播放策略），别让按钮一直转圈
    await Promise.race([
      resumed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('audio context stayed suspended')), 3000)
      ),
    ]);
  } catch (error) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (owned) void context.close();
    throw error;
  }
  const tracks = stream.getTracks();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor 已弃用但 Safari/Electron 都可用，免去 AudioWorklet 的模块加载与 CSP
  const processor = context.createScriptProcessor(4096, 1, 1);
  const downsample = createDownsampler(context.sampleRate);
  let peak = 0;
  let resolveLive = () => {};
  const live = new Promise<void>((resolve) => {
    resolveLive = resolve;
  });
  const liveTimer = setTimeout(resolveLive, LIVE_TIMEOUT_MS);
  const markLive = () => {
    clearTimeout(liveTimer);
    resolveLive();
  };
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) markLive();
    options.onLevel?.(levelFromSamples(data));
    const samples = downsample(new Float32Array(data));
    if (samples.length > 0) onChunk(samples);
  };
  source.connect(processor);
  processor.connect(context.destination);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    markLive();
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    for (const track of tracks) track.stop();
    if (owned) void context.close();
  };
  return {
    live,
    cancel: release,
    stop: async () => {
      release();
      if (peak === 0) throw new SilentRecordingError('silent recording');
    },
  };
}
