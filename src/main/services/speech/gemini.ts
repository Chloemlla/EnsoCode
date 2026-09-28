import type { SpeechEngineStream } from './engine';
import { joinSegments } from './text';

const MODEL = 'models/gemini-3.5-transcribe-live';
const HOST = 'generativelanguage.googleapis.com';
const ENDPOINT = `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;
/** 松手后通常 0.5s 内定稿，只兜底断网 */
const FINISH_TIMEOUT_MS = 15_000;
/** 官方建议词表不超过 100 条效果最好 */
const VOCABULARY_MAX = 100;

export interface GeminiHandlers {
  open(): void;
  message(data: unknown): void;
  close(reason: string): void;
}

export type GeminiConnect = (
  url: string,
  on: GeminiHandlers
) => { send(data: string): void; close(): void };

const connectWebSocket: GeminiConnect = (url, on) => {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => on.open();
  socket.onmessage = (event) => on.message(event.data);
  socket.onclose = (event) => on.close(event.reason || `closed (${event.code})`);
  return {
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    close: () => socket.close(),
  };
};

export function geminiApiKeyFromSettings(state: Record<string, unknown>): string | null {
  const key = state.voiceGeminiApiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function parseVocabulary(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const terms = raw
    .split(/[\n,，]/)
    .map((term) => term.trim())
    .filter(Boolean);
  return [...new Set(terms)].slice(0, VOCABULARY_MAX);
}

function pcm16Base64(samples: Float32Array): string {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return out.toString('base64');
}

function parse(data: unknown): Record<string, unknown> | null {
  try {
    const text =
      typeof data === 'string'
        ? data
        : new TextDecoder().decode(data instanceof ArrayBuffer ? data : (data as Uint8Array));
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * gemini-3.5-transcribe-live 按住说话：一次录音一条连接，手动 activityStart/End。
 * 建连期间的音频先排队；interim 是当前句的累计预览，inputTranscription 是定稿句。
 */
export function openGeminiLiveStream(
  options: { apiKey: string; vocabulary: readonly string[] },
  connect: GeminiConnect = connectWebSocket
): SpeechEngineStream {
  const finals: string[] = [];
  let interim = '';
  let open = false;
  let failure: Error | null = null;
  let settled = false;
  const queue: string[] = [];
  let resolveDone: ((text: string) => void) | null = null;
  let rejectDone: ((error: Error) => void) | null = null;
  let timer: NodeJS.Timeout | undefined;

  const text = () => joinSegments(interim ? [...finals, interim] : finals);
  const settle = () => {
    settled = true;
    clearTimeout(timer);
    socket.close();
  };
  const fail = (error: Error) => {
    if (settled) return;
    failure ??= error;
    settle();
    rejectDone?.(failure);
  };
  const send = (message: unknown) => {
    const data = JSON.stringify(message);
    if (open) socket.send(data);
    else queue.push(data);
  };

  const socket = connect(`${ENDPOINT}?key=${encodeURIComponent(options.apiKey)}`, {
    open: () => {
      open = true;
      for (const data of queue.splice(0)) socket.send(data);
    },
    message: (data) => {
      const message = parse(data);
      if (!message || settled) return;
      const error = record(message.error);
      if (error) {
        fail(new Error(String(error.message ?? 'gemini live error')));
        return;
      }
      const content = record(message.serverContent);
      const final = record(content?.inputTranscription)?.text;
      const partial = record(content?.interimInputTranscription)?.text;
      if (typeof final === 'string') {
        if (final) finals.push(final);
        interim = '';
      } else if (typeof partial === 'string') {
        interim = partial;
      }
      // 有话时 generationComplete 在定稿后到；静音录音只回 ACTIVITY_END
      const ended =
        content?.generationComplete === true ||
        record(message.voiceActivity)?.type === 'ACTIVITY_END';
      if (ended && resolveDone) {
        const result = joinSegments(finals.length ? finals : [interim]);
        settle();
        resolveDone(result);
      }
    },
    close: (reason) => fail(new Error(`gemini live closed: ${reason}`)),
  });

  send({
    setup: {
      model: MODEL,
      generationConfig: { responseModalities: ['TEXT'] },
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      // SMART 会改写原意（实测把“PR 的 CI 失败”改没了），听写只要逐字
      inputAudioTranscription: {
        languageCodes: [],
        mode: 'VERBATIM',
        ...(options.vocabulary.length ? { customVocabulary: [...options.vocabulary] } : {}),
      },
    },
  });
  send({ realtimeInput: { activityStart: {} } });

  return {
    accept: (samples) => {
      if (failure) return Promise.reject(failure);
      send({
        realtimeInput: { audio: { data: pcm16Base64(samples), mimeType: 'audio/pcm;rate=16000' } },
      });
      return Promise.resolve(text());
    },
    finish: () => {
      if (failure) return Promise.reject(failure);
      const done = new Promise<string>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      timer = setTimeout(() => fail(new Error('gemini live timed out')), FINISH_TIMEOUT_MS);
      send({ realtimeInput: { activityEnd: {} } });
      return done;
    },
    cancel: () => {
      if (settled) return;
      failure = new Error('cancelled');
      settle();
    },
  };
}
