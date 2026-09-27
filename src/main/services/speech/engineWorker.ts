import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { SPEECH_SAMPLE_RATE } from '@shared/types/speech';
import type { EngineRequest, EngineWorkerData } from './engine';

/**
 * 原生识别跑在 worker 线程：OnlineRecognizer 的构造与 decode 全是同步调用，
 * 放主进程会在加载（约 1.5s）和每块解码时卡住 IPC。
 */

interface Stream {
  acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
  inputFinished?(): void;
}
interface Offline {
  createStream(): Stream;
  decode(stream: Stream): void;
  getResult(stream: Stream): { text?: unknown };
}
interface Online {
  createStream(): Stream;
  isReady(stream: Stream): boolean;
  decode(stream: Stream): void;
  isEndpoint(stream: Stream): boolean;
  reset(stream: Stream): void;
  getResult(stream: Stream): { text?: unknown };
}

const port = parentPort;
const init = workerData as EngineWorkerData;
/** 收尾补一段静音，把编码器右侧上下文里的最后几个字冲出来 */
const TAIL = new Float32Array(SPEECH_SAMPLE_RATE / 2);

const text = (result: { text?: unknown }) => (typeof result.text === 'string' ? result.text : '');

if (port) {
  let offline: Offline | null = null;
  let online: Online | null = null;
  const streams = new Map<number, { stream: Stream; segments: string[] }>();
  try {
    // 不能写成 require(...)：electron-vite 见到它会插 CJS shim
    const sherpa = createRequire(import.meta.url)(init.wrapperDir) as {
      OfflineRecognizer: new (config: unknown) => Offline;
      OnlineRecognizer: new (config: unknown) => Online;
    };
    if (init.kind === 'offline') offline = new sherpa.OfflineRecognizer(init.config);
    else online = new sherpa.OnlineRecognizer(init.config);
    port.postMessage({ ready: true });
  } catch (error) {
    port.postMessage({ ready: false, error: String(error) });
  }

  const drain = (entry: { stream: Stream; segments: string[] }): string => {
    const rec = online as Online;
    while (rec.isReady(entry.stream)) rec.decode(entry.stream);
    const current = text(rec.getResult(entry.stream));
    if (!rec.isEndpoint(entry.stream)) return entry.segments.join('') + current;
    if (current) entry.segments.push(current);
    rec.reset(entry.stream);
    return entry.segments.join('');
  };

  port.on('message', (req: EngineRequest) => {
    try {
      switch (req.op) {
        case 'transcribe': {
          const rec = offline as Offline;
          const stream = rec.createStream();
          stream.acceptWaveform({ samples: req.samples, sampleRate: SPEECH_SAMPLE_RATE });
          rec.decode(stream);
          port.postMessage({ id: req.id, ok: true, text: text(rec.getResult(stream)) });
          return;
        }
        case 'open':
          streams.set(req.sid, { stream: (online as Online).createStream(), segments: [] });
          port.postMessage({ id: req.id, ok: true, text: '' });
          return;
        case 'accept': {
          const entry = streams.get(req.sid);
          if (!entry) throw new Error('unknown stream');
          entry.stream.acceptWaveform({ samples: req.samples, sampleRate: SPEECH_SAMPLE_RATE });
          port.postMessage({ id: req.id, ok: true, text: drain(entry) });
          return;
        }
        case 'finish': {
          const entry = streams.get(req.sid);
          if (!entry) throw new Error('unknown stream');
          streams.delete(req.sid);
          entry.stream.acceptWaveform({ samples: TAIL, sampleRate: SPEECH_SAMPLE_RATE });
          entry.stream.inputFinished?.();
          const rec = online as Online;
          while (rec.isReady(entry.stream)) rec.decode(entry.stream);
          const last = text(rec.getResult(entry.stream));
          port.postMessage({ id: req.id, ok: true, text: entry.segments.join('') + last });
          return;
        }
        case 'cancel':
          streams.delete(req.sid);
          port.postMessage({ id: req.id, ok: true, text: '' });
          return;
      }
    } catch (error) {
      port.postMessage({ id: req.id, ok: false, error: String(error) });
    }
  });
}
