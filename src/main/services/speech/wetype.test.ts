import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadWetypeIdentity,
  openWetypeStream,
  saveWetypeIdentity,
  type WetypeVoiceChannel,
  type WetypeVoicePacket,
} from './wetype';
import { fromUtf8 } from './wetypeProtocol';

const FRAME = 320;
const HEADER = '#!OPUS_RAW_V1';

function fakeChannel(
  replies: (
    packet: WetypeVoicePacket,
    index: number
  ) => {
    text?: string;
    polished?: string;
  }
) {
  const sent: WetypeVoicePacket[] = [];
  let closed = false;
  const channel: WetypeVoiceChannel = {
    send: async (packet) => {
      if (closed) throw new Error('closed');
      sent.push(packet);
      return { text: '', polished: '', ...replies(packet, sent.length - 1) };
    },
    close: () => {
      closed = true;
    },
  };
  return { channel, sent, isClosed: () => closed };
}

function fakeEncoder() {
  const state = { frames: 0, freed: false };
  return {
    state,
    create: async () => ({
      encode: (pcm: Float32Array) => {
        expect(pcm.length).toBe(FRAME);
        state.frames++;
        return Uint8Array.of(state.frames);
      },
      free: () => {
        state.freed = true;
      },
    }),
  };
}

const audio = (frames: number) => new Float32Array(frames * FRAME);

describe('wetype stream', () => {
  it('uploads six opus packets per request, headed on the first, and returns cumulative text', async () => {
    const { channel, sent } = fakeChannel((p) => (p.seq === 2 ? { text: '你好' } : {}));
    const encoder = fakeEncoder();
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: encoder.create,
      pollIntervalMs: 0,
    });
    await expect(stream.accept(audio(5))).resolves.toBe('');
    expect(sent).toHaveLength(0);
    await expect(stream.accept(audio(7))).resolves.toBe('你好');
    expect(sent.map((p) => [p.seq, p.isEnd])).toEqual([
      [1, false],
      [2, false],
    ]);
    const first = sent[0].opus!;
    expect(fromUtf8(first.subarray(0, HEADER.length))).toBe(HEADER);
    expect(first.length).toBe(HEADER.length + 3 + 6 * 3);
    expect(sent[1].opus!.length).toBe(6 * 3);
    expect(sent[1].totalBytes).toBe(first.length + 18);
  });

  it('pads the tail frame, ends the upload and polls until the polished text arrives', async () => {
    const { channel, sent, isClosed } = fakeChannel((p, i) =>
      p.seq === 0 ? (i >= 3 ? { text: '你好。', polished: '你好！' } : { text: '你好。' }) : {}
    );
    const encoder = fakeEncoder();
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: encoder.create,
      pollIntervalMs: 0,
    });
    await stream.accept(new Float32Array(FRAME + 10));
    await expect(stream.finish()).resolves.toBe('你好！');
    expect(encoder.state.frames).toBe(2);
    expect(sent.map((p) => [p.seq, p.isEnd, p.opus?.length ?? 0])).toEqual([
      [1, true, 16 + 6],
      [0, true, 0],
      [0, true, 0],
      [0, true, 0],
    ]);
    expect(isClosed()).toBe(true);
    expect(encoder.state.freed).toBe(true);
  });

  it('falls back to the streaming text when no polished text arrives', async () => {
    const { channel, sent } = fakeChannel(() => ({ text: '字' }));
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: fakeEncoder().create,
      pollIntervalMs: 0,
    });
    await stream.accept(audio(1));
    await expect(stream.finish()).resolves.toBe('字');
    expect(sent.filter((p) => p.seq === 0).length).toBeGreaterThan(1);
  });

  it('rejects accept and finish when the handshake fails', async () => {
    const stream = openWetypeStream({
      openChannel: () => Promise.reject(new Error('handshake failed')),
      createEncoder: fakeEncoder().create,
      pollIntervalMs: 0,
    });
    await expect(stream.accept(audio(6))).rejects.toThrow('handshake failed');
    await expect(stream.finish()).rejects.toThrow('handshake failed');
  });

  it('returns the channel when the encoder fails to start', async () => {
    const { channel, isClosed } = fakeChannel(() => ({}));
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: () => Promise.reject(new Error('no wasm')),
      pollIntervalMs: 0,
    });
    await expect(stream.finish()).rejects.toThrow('no wasm');
    await Promise.resolve();
    expect(isClosed()).toBe(true);
  });

  it('closes the channel on cancel and refuses further audio', async () => {
    const { channel, isClosed } = fakeChannel(() => ({}));
    const encoder = fakeEncoder();
    const stream = openWetypeStream({
      openChannel: async () => channel,
      createEncoder: encoder.create,
      pollIntervalMs: 0,
    });
    await stream.accept(audio(1));
    stream.cancel();
    await expect(stream.accept(audio(6))).rejects.toThrow('cancelled');
    expect(isClosed()).toBe(true);
    expect(encoder.state.freed).toBe(true);
  });
});

describe('wetype identity', () => {
  let dir = '';
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('persists the server-issued device and UIN and ignores malformed files', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wetype-'));
    const file = path.join(dir, 'nested', 'wetype.json');
    expect(loadWetypeIdentity(file)).toBeNull();
    saveWetypeIdentity(file, { device: 'MACdevice', uin: '8848109380590273' });
    expect(loadWetypeIdentity(file)).toEqual({ device: 'MACdevice', uin: '8848109380590273' });
    fs.writeFileSync(file, JSON.stringify({ device: 'x', uin: 'abc' }));
    expect(loadWetypeIdentity(file)).toBeNull();
    fs.writeFileSync(file, '{');
    expect(loadWetypeIdentity(file)).toBeNull();
  });
});
