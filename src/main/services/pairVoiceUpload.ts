import { decodeVoiceChunk } from '@enso/pair';
import {
  SPEECH_MAX_SECONDS,
  SPEECH_SAMPLE_RATE,
  type SpeechErrorCode,
  type SpeechTranscribeResult,
  type StartVoiceSession,
  type VoiceSession,
} from '@shared/types/speech';

/**
 * 手机语音流式上传（单连接一份）：首块到达即开识别会话，边收边 push。
 * 直连/中继回退会乱序，按 index 缓冲，只推从 0 连续的前缀；末块及之前全齐才 finish。
 */

export interface VoiceChunkInput {
  requestId: string;
  index: number;
  data: string;
  last?: true;
}

export type VoiceUploadResult =
  | { kind: 'finish'; requestId: string; result: Promise<SpeechTranscribeResult> }
  | { kind: 'error'; requestId: string; error: SpeechErrorCode };

interface Upload {
  session: VoiceSession;
  timer?: ReturnType<typeof setTimeout>;
  pending: Map<number, Int16Array>;
  next: number;
  maxIndex: number;
  total?: number;
  samples: number;
}

/** 已失败/结束的 requestId 记一阵，后续分块静默丢弃，避免重开半截会话占名额 */
const DEAD_MAX = 32;

export class VoiceUploads {
  private uploads = new Map<string, Upload>();
  /** 已收齐、正在出定稿（可能在纠错）；这期间的中间结果仍要转出 */
  private finishing = new Set<Upload>();
  private dead = new Set<string>();
  private readonly open: StartVoiceSession;
  private readonly onPartial: (requestId: string, text: string, correcting: boolean) => void;
  private readonly maxSamples: number;
  private readonly maxActive: number;
  private readonly ttlMs: number;

  constructor(options: {
    open: StartVoiceSession;
    onPartial: (requestId: string, text: string, correcting: boolean) => void;
    maxSamples?: number;
    maxActive?: number;
    /** 距最后一次收到分块的空闲上限；录音本身可长达数分钟 */
    ttlMs?: number;
  }) {
    this.open = options.open;
    this.onPartial = options.onPartial;
    this.maxSamples = options.maxSamples ?? SPEECH_SAMPLE_RATE * SPEECH_MAX_SECONDS;
    this.maxActive = options.maxActive ?? 2;
    this.ttlMs = options.ttlMs ?? 30_000;
  }

  /** null = 等待更多分块或已忽略 */
  accept(chunk: VoiceChunkInput): VoiceUploadResult | null {
    const { requestId, index } = chunk;
    if (this.dead.has(requestId)) return null;
    const pcm = decodeVoiceChunk(chunk.data);
    let upload = this.uploads.get(requestId);
    if (!upload) {
      if (this.uploads.size >= this.maxActive) return this.fail(requestId, 'failed');
      if (!pcm) return this.fail(requestId, 'invalid-audio');
      upload = this.start(requestId);
    }
    if (!pcm || index < upload.next || upload.pending.has(index)) {
      return this.fail(requestId, 'invalid-audio');
    }
    if (chunk.last) {
      if (upload.total !== undefined || upload.maxIndex >= index) {
        return this.fail(requestId, 'invalid-audio');
      }
      upload.total = index + 1;
    } else if (upload.total !== undefined && index >= upload.total) {
      return this.fail(requestId, 'invalid-audio');
    }
    upload.samples += pcm.length;
    if (upload.samples > this.maxSamples) return this.fail(requestId, 'invalid-audio');
    upload.maxIndex = Math.max(upload.maxIndex, index);
    upload.pending.set(index, pcm);
    clearTimeout(upload.timer);
    upload.timer = setTimeout(() => this.cancel(requestId), this.ttlMs);
    for (let part = upload.pending.get(upload.next); part; part = upload.pending.get(upload.next)) {
      upload.pending.delete(upload.next++);
      const samples = new Float32Array(part.length);
      for (let i = 0; i < part.length; i++) samples[i] = part[i] / 32768;
      upload.session.push(samples);
    }
    if (upload.next !== upload.total) return null;
    this.retire(requestId, upload);
    this.finishing.add(upload);
    const result = upload.session.finish();
    const settled = () => this.finishing.delete(upload);
    result.then(settled, settled);
    return { kind: 'finish', requestId, result };
  }

  /** 取消并判死；未知 id 忽略 */
  cancel(requestId: string): void {
    const upload = this.uploads.get(requestId);
    if (!upload) return;
    this.retire(requestId, upload);
    upload.session.cancel();
  }

  clear(): void {
    for (const upload of this.uploads.values()) {
      clearTimeout(upload.timer);
      upload.session.cancel();
    }
    this.uploads.clear();
    this.finishing.clear();
    this.dead.clear();
  }

  private start(requestId: string): Upload {
    const upload: Upload = {
      // 取消或定稿送出后的迟到中间结果不再转出
      session: this.open((text, correcting) => {
        if (this.uploads.get(requestId) === upload || this.finishing.has(upload)) {
          this.onPartial(requestId, text, correcting);
        }
      }),
      pending: new Map(),
      next: 0,
      maxIndex: -1,
      samples: 0,
    };
    this.uploads.set(requestId, upload);
    return upload;
  }

  private fail(requestId: string, error: SpeechErrorCode): VoiceUploadResult {
    this.cancel(requestId);
    this.markDead(requestId);
    return { kind: 'error', requestId, error };
  }

  /** 移出活跃表（释放名额、停 TTL）并判死 */
  private retire(requestId: string, upload: Upload): void {
    clearTimeout(upload.timer);
    this.uploads.delete(requestId);
    this.markDead(requestId);
  }

  private markDead(requestId: string): void {
    this.dead.delete(requestId);
    this.dead.add(requestId);
    if (this.dead.size > DEAD_MAX) this.dead.delete(this.dead.values().next().value as string);
  }
}
