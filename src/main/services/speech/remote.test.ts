import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ConnectRemote, createRemoteSpeechEngine, type RemoteHandlers } from './remote';

interface FakeSocket {
  url: string;
  on: RemoteHandlers;
  sent: (string | Uint8Array)[];
  closed: boolean;
}

let sockets: FakeSocket[] = [];
const connect: ConnectRemote = (url, on) => {
  const socket: FakeSocket = { url, on, sent: [], closed: false };
  sockets.push(socket);
  return {
    send: (data) => {
      socket.sent.push(data);
    },
    close: () => {
      socket.closed = true;
    },
  };
};

const reply = (socket: FakeSocket, message: Record<string, unknown>) =>
  socket.on.message(JSON.stringify(message));
const result = (socket: FakeSocket, text: string, final = false) =>
  reply(socket, { type: 'result', text, interim: !final, final });
const binary = (socket: FakeSocket) =>
  socket.sent.filter((data): data is Uint8Array => data instanceof Uint8Array);
const controls = (socket: FakeSocket) =>
  socket.sent.filter((data): data is string => typeof data === 'string').map((s) => JSON.parse(s));
const int16 = (bytes: Uint8Array) =>
  Array.from(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)));
const sentBytes = (socket: FakeSocket) =>
  binary(socket).reduce((sum, bytes) => sum + bytes.length, 0);

function open() {
  const stream = createRemoteSpeechEngine('https://asr.test', { connect }).openStream();
  const socket = sockets.at(-1) as FakeSocket;
  socket.on.open();
  return { stream, socket };
}

afterEach(() => {
  sockets = [];
  vi.useRealTimers();
});

describe('remote speech stream', () => {
  it('buffers audio until the service is ready, then streams PCM16LE and returns the text on done', async () => {
    const { stream, socket } = open();
    expect(socket.url).toBe('wss://asr.test/ws');
    expect(controls(socket)).toEqual([{ type: 'init' }]);
    await stream.accept(new Float32Array([0.5, -1, 1, 2]));
    expect(binary(socket)).toEqual([]);
    reply(socket, { type: 'ready' });
    expect(binary(socket).map(int16)).toEqual([[16383, -32768, 32767, 32767]]);
    await stream.accept(new Float32Array([0]));
    expect(binary(socket)).toHaveLength(2);
    const finished = stream.finish();
    expect(controls(socket)).toEqual([{ type: 'init' }, { type: 'finish' }]);
    result(socket, '你好。', true);
    reply(socket, { type: 'done' });
    await expect(finished).resolves.toBe('你好。');
    expect(socket.closed).toBe(true);
  });

  it('sends finish only after the buffered audio once the service becomes ready', async () => {
    const { stream, socket } = open();
    await stream.accept(new Float32Array(16_000));
    const finished = stream.finish();
    expect(controls(socket)).toEqual([{ type: 'init' }]);
    reply(socket, { type: 'ready' });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'finish' }));
    expect(binary(socket).reduce((sum, bytes) => sum + bytes.length, 0)).toBe(32_000);
    reply(socket, { type: 'done' });
    await expect(finished).resolves.toBe('');
  });

  it('joins per-utterance finals with the live partial instead of concatenating updates', async () => {
    const { stream, socket } = open();
    reply(socket, { type: 'ready' });
    result(socket, '你好');
    await expect(stream.accept(new Float32Array(1))).resolves.toBe('你好');
    result(socket, '你好。', true);
    result(socket, '然后');
    reply(socket, { type: 'result', text: '然后打开', interim: false, final: false });
    await expect(stream.accept(new Float32Array(1))).resolves.toBe('你好。然后打开');
    result(socket, '然后打开 settings json。', true);
    const finished = stream.finish();
    reply(socket, { type: 'done' });
    await expect(finished).resolves.toBe('你好。然后打开 settings json。');
  });

  it('redials with the buffered audio when the service fails before it is ready', async () => {
    vi.useFakeTimers();
    const { stream, socket } = open();
    await stream.accept(new Float32Array([0.5]));
    reply(socket, { type: 'error', error: 'Error: timeout connecting ASR WebSocket' });
    expect(socket.closed).toBe(true);
    const second = sockets[1];
    second.on.open();
    await vi.advanceTimersByTimeAsync(25_000);
    const third = sockets[2];
    expect(second.closed).toBe(true);
    third.on.open();
    reply(third, { type: 'ready' });
    expect(binary(third).map(int16)).toEqual([[16383]]);
    const finished = stream.finish();
    socket.on.close();
    reply(third, { type: 'done' });
    await expect(finished).resolves.toBe('');
    expect(sockets).toHaveLength(3);
  });

  it('replays the whole recording on a new connection when the service fails midway', async () => {
    const { stream, socket } = open();
    await stream.accept(new Float32Array([0.5]));
    reply(socket, { type: 'ready' });
    await stream.accept(new Float32Array([-1]));
    result(socket, '半句');
    reply(socket, { type: 'error', error: 'Error: SessionFailed (50700000)' });
    expect(socket.closed).toBe(true);
    const next = sockets[1];
    next.on.open();
    await expect(stream.accept(new Float32Array([1]))).resolves.toBe('');
    reply(next, { type: 'ready' });
    expect(binary(next).map(int16)).toEqual([[16383, -32768, 32767]]);
    const finished = stream.finish();
    result(next, '完整一句。', true);
    reply(next, { type: 'done' });
    await expect(finished).resolves.toBe('完整一句。');
  });

  it('gives up after three failed attempts', async () => {
    const { stream } = open();
    const finished = stream.finish();
    sockets[0].on.close();
    sockets[1].on.open();
    reply(sockets[1], { type: 'ready' });
    sockets[1].on.close();
    reply(sockets[2], { type: 'error', error: 'Error: upstream 40200011' });
    await expect(finished).rejects.toThrow('40200011');
    expect(sockets).toHaveLength(3);
  });

  it('redials when done never arrives after finish', async () => {
    vi.useFakeTimers();
    const { stream, socket } = open();
    reply(socket, { type: 'ready' });
    await stream.accept(new Float32Array([0.5]));
    const finished = stream.finish();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.closed).toBe(true);
    const next = sockets[1];
    next.on.open();
    reply(next, { type: 'ready' });
    expect(binary(next).map(int16)).toEqual([[16383]]);
    expect(next.sent.at(-1)).toBe(JSON.stringify({ type: 'finish' }));
    reply(next, { type: 'done' });
    await expect(finished).resolves.toBe('');
  });

  it('closes the connection on cancel and ignores later audio', async () => {
    const { stream, socket } = open();
    reply(socket, { type: 'ready' });
    stream.cancel();
    expect(socket.closed).toBe(true);
    await stream.accept(new Float32Array(1));
    expect(binary(socket)).toEqual([]);
    await expect(stream.finish()).rejects.toThrow();
  });

  it('paces a long backlog so the service can keep up before finish', async () => {
    vi.useFakeTimers();
    const { stream, socket } = open();
    await stream.accept(new Float32Array(16_000 * 30));
    reply(socket, { type: 'ready' });
    const burst = sentBytes(socket);
    expect(burst).toBeGreaterThanOrEqual(32_000 * 10);
    expect(burst).toBeLessThan(32_000 * 30);
    const finished = stream.finish();
    expect(controls(socket)).toEqual([{ type: 'init' }]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sentBytes(socket)).toBeGreaterThan(burst);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sentBytes(socket)).toBe(32_000 * 30);
    expect(Math.max(...binary(socket).map((bytes) => bytes.length))).toBeLessThanOrEqual(32_000);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'finish' }));
    reply(socket, { type: 'done' });
    await expect(finished).resolves.toBe('');
  });
});

describe('remote whole-recording transcription', () => {
  const post = (...responses: (Response | Error)[]) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift() ?? new Error('no more responses');
      if (next instanceof Error) throw next;
      return next;
    }) as typeof globalThis.fetch;
    return { calls, engine: createRemoteSpeechEngine('https://asr.test', { connect, fetch }) };
  };

  it('posts the recording as PCM16LE to /asr without opening a stream', async () => {
    const { calls, engine } = post(Response.json({ text: '第一句。Second.' }));
    await expect(engine.transcribe(new Float32Array([0.5, -1]))).resolves.toBe('第一句。Second.');
    expect(sockets).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://asr.test/asr');
    expect(calls[0].init.method).toBe('POST');
    expect(int16(calls[0].init.body as Uint8Array)).toEqual([16383, -32768]);
  });

  it('retries server and network failures, then returns the text', async () => {
    vi.useFakeTimers();
    const { calls, engine } = post(
      Response.json({ error: 'Error: SessionFailed (50700000)' }, { status: 502 }),
      new TypeError('fetch failed'),
      Response.json({ text: '好。' })
    );
    const text = engine.transcribe(new Float32Array([0.5]));
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(text).resolves.toBe('好。');
    expect(calls).toHaveLength(3);
  });

  it('gives up after three failures and does not retry bad audio', async () => {
    vi.useFakeTimers();
    const failing = post(
      ...Array.from({ length: 3 }, () =>
        Response.json({ error: 'Error: timeout connecting ASR WebSocket' }, { status: 502 })
      )
    );
    const text = failing.engine.transcribe(new Float32Array([0.5]));
    const rejected = expect(text).rejects.toThrow('timeout connecting ASR WebSocket');
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(failing.calls).toHaveLength(3);

    const bad = post(Response.json({ error: 'empty audio' }, { status: 400 }));
    await expect(bad.engine.transcribe(new Float32Array([0.5]))).rejects.toThrow('empty audio');
    expect(bad.calls).toHaveLength(1);
  });
});
