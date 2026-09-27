import type { SpeechEngine, SpeechEngineStream } from './engine';
import { joinSegments } from './text';

/** 实测建连到 ready 常需 3-10s；服务端排队最多 10s、连上游 12s 超时会自己报错，这里只兜底断网 */
const READY_TIMEOUT_MS = 25_000;
const DONE_TIMEOUT_MS = 30_000;
/** 上游偶发建连超时、SessionFailed、结束时超时：音频留在本地，失败即换连接 / 重发请求 */
const MAX_ATTEMPTS = 3;
/** 整段上传：排队 + 建连最坏约 40s，上游消化约 5 倍实时，按录音时长的一半再留余量 */
const POST_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 1_000;
/** PCM16LE 16kHz 单声道 */
const BYTES_PER_MS = 32;
/** 积压音频按 1s 一块补发，避开服务端待处理消息条数上限 */
const FLUSH_BYTES = 1_000 * BYTES_PER_MS;
/** 积压先补发 20s，其余按 4 倍实时匀速：长录音断线重放时不撑爆服务端待处理队列（4 MiB） */
const BURST_BYTES = 20_000 * BYTES_PER_MS;
const PACE_BYTES_PER_MS = 4 * BYTES_PER_MS;

export interface RemoteHandlers {
  open(): void;
  message(data: unknown): void;
  close(): void;
}

export interface RemoteConnection {
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(): void;
}

export type ConnectRemote = (url: string, on: RemoteHandlers) => RemoteConnection;

export interface RemoteIo {
  connect?: ConnectRemote;
  fetch?: typeof fetch;
}

const connectWebSocket: ConnectRemote = (url, on) => {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => on.open();
  socket.onmessage = (event) => on.message(event.data);
  socket.onclose = () => on.close();
  return {
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    close: () => socket.close(),
  };
};

function toPcm16(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parse(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    return record(JSON.parse(data));
  } catch {
    return null;
  }
}

/** 服务端 5xx / 网络错误多为上游偶发，重发整段；4xx 是音频本身的问题，不重试 */
async function postRecording(url: string, samples: Float32Array, post: typeof fetch) {
  const body = toPcm16(samples);
  const timeoutMs = POST_TIMEOUT_MS + Math.ceil(body.length / BYTES_PER_MS / 2);
  let error = new Error('speech service failed');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const response = await post(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = record(await response.json().catch(() => null));
      if (response.ok && typeof data?.text === 'string') return data.text;
      error = new Error(`speech service ${response.status}: ${String(data?.error ?? '')}`);
      if (response.status < 500) break;
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause));
    }
  }
  throw error;
}

function openRemoteStream(url: string, connect: ConnectRemote): SpeechEngineStream {
  let pcm = new Uint8Array(0);
  let length = 0;
  const finals: string[] = [];
  let partial = '';
  let conn: RemoteConnection | null = null;
  let ready = false;
  let readyAt = 0;
  let sent = 0;
  let finishSent = false;
  let finishing = false;
  let settled = false;
  let attempts = 0;
  let timer: NodeJS.Timeout | undefined;
  let pumpTimer: NodeJS.Timeout | undefined;
  let resolveDone!: (text: string) => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<string>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});

  const text = () => joinSegments([...finals, partial]);

  const hangUp = () => {
    clearTimeout(timer);
    clearTimeout(pumpTimer);
    const current = conn;
    conn = null;
    current?.close();
  };

  const settle = (error: Error | null) => {
    if (settled) return;
    settled = true;
    hangUp();
    if (error) rejectDone(error);
    else resolveDone(text());
  };

  const arm = (ms: number, reason: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => drop(new Error(reason)), ms);
    timer.unref?.();
  };

  const drop = (error: Error) => {
    if (settled) return;
    hangUp();
    if (attempts < MAX_ATTEMPTS) dial();
    else settle(error);
  };

  const append = (bytes: Uint8Array) => {
    if (length + bytes.length > pcm.length) {
      const grown = new Uint8Array(Math.max(length + bytes.length, pcm.length * 2));
      grown.set(pcm.subarray(0, length));
      pcm = grown;
    }
    pcm.set(bytes, length);
    length += bytes.length;
  };

  /** 把本连接还没发的音频按限速发出去，发完且已结束录音再发 finish */
  const pump = () => {
    clearTimeout(pumpTimer);
    if (!conn || !ready) return;
    const budget = BURST_BYTES + (Date.now() - readyAt) * PACE_BYTES_PER_MS;
    while (sent < length && sent < budget) {
      const end = Math.min(length, sent + FLUSH_BYTES);
      conn.send(pcm.subarray(sent, end));
      sent = end;
    }
    if (sent < length) {
      pumpTimer = setTimeout(pump, Math.ceil((sent - budget + 1) / PACE_BYTES_PER_MS));
      pumpTimer.unref?.();
    } else if (finishing && !finishSent) {
      finishSent = true;
      conn.send(JSON.stringify({ type: 'finish' }));
      arm(DONE_TIMEOUT_MS, 'speech service did not finish in time');
    }
  };

  const onMessage = (message: Record<string, unknown>) => {
    switch (message.type) {
      case 'ready':
        if (ready) return;
        ready = true;
        readyAt = Date.now();
        clearTimeout(timer);
        pump();
        return;
      case 'result':
        if (typeof message.text !== 'string') return;
        if (message.final === true) {
          finals.push(message.text);
          partial = '';
        } else partial = message.text;
        return;
      case 'done':
        settle(null);
        return;
      case 'error':
        drop(new Error(`speech service: ${String(message.error)}`));
        return;
    }
  };

  const dial = () => {
    attempts++;
    ready = false;
    sent = 0;
    finishSent = false;
    finals.length = 0;
    partial = '';
    let current: RemoteConnection | null = null;
    const on: RemoteHandlers = {
      open: () => {
        if (conn === current) current?.send(JSON.stringify({ type: 'init' }));
      },
      message: (data) => {
        const message = conn === current ? parse(data) : null;
        if (message) onMessage(message);
      },
      close: () => {
        if (conn === current) drop(new Error('speech service closed the connection'));
      },
    };
    arm(READY_TIMEOUT_MS, 'speech service was not ready in time');
    try {
      current = connect(url, on);
      conn = current;
    } catch (error) {
      drop(error instanceof Error ? error : new Error(String(error)));
    }
  };

  dial();

  return {
    accept: (samples) => {
      if (!settled && !finishing) {
        append(toPcm16(samples));
        pump();
      }
      return Promise.resolve(text());
    },
    finish: () => {
      if (!finishing && !settled) {
        finishing = true;
        pump();
      }
      return done;
    },
    cancel: () => settle(new Error('cancelled')),
  };
}

/**
 * 第三方识别：音频转 PCM16LE，流式走 WebSocket `/ws`，整段走 HTTP `POST /asr`。
 * 无本地资源，dispose 为空操作
 */
export function createRemoteSpeechEngine(
  base: string,
  { connect = connectWebSocket, fetch: post = fetch }: RemoteIo = {}
): SpeechEngine {
  const streamUrl = `${base.replace(/^http/, 'ws')}/ws`;
  return {
    transcribe: (samples) => postRecording(`${base}/asr`, samples, post),
    openStream: () => openRemoteStream(streamUrl, connect),
    dispose: () => {},
  };
}
