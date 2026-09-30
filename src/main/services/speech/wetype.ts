import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SpeechEngineStream } from './engine';
import {
  aesDecrypt,
  aesEncrypt,
  buildVoiceRequest,
  concatBytes,
  ecdhSharedX,
  frameOpusPackets,
  fromUtf8,
  generateDeviceCode,
  generateKeyPair,
  hexUpper,
  md5Upper,
  PBuf,
  parseVoiceResponse,
  pbBytes,
  pbParse,
  pbVarint,
  randomLower,
  SIGN_KEY,
  sha256Upper,
  snappyCompress,
  snappyDecompress,
  utf8,
} from './wetypeProtocol';

const HOST = 'wetype.weixin.qq.com';
const BOOT_KEY = utf8('D4Y5U3Y2M0C0T7N4P1P7O2N6E1I2Y1U6');
const VERSION = '2.2.3(657)';
const OS_TYPE = '5';
const PLATFORM = '2';
const DEVICE_MODEL = 'Mac16,12';
const CMD_DH = 2147483646;
const CMD_UIN = 0x7ffffdfd;
/** Notify：握手收尾发一次 */
const CMD_NOTIFY = 8074;
const CMD_VOICE = 4548;
const OPUS_HEADER = concatBytes(utf8('#!OPUS_RAW_V1'), Uint8Array.of(2, 1, 0));
/** 16kHz 下 20ms 一帧，6 帧一个请求（与官方客户端一致） */
const FRAME = 320;
const PACKETS_PER_REQUEST = 6;
const RECV_TIMEOUT_MS = 15_000;
/** 结束后轮询定稿：实测首轮即带回整理文本 */
const MAX_POLLS = 8;

export interface WetypeIdentity {
  device: string;
  uin: string;
}

export interface WetypeVoicePacket {
  voiceId: string;
  opus?: Uint8Array;
  seq: number;
  totalBytes: number;
  isEnd: boolean;
}

export interface WetypeVoiceChannel {
  send(packet: WetypeVoicePacket): Promise<{ text: string; polished: string }>;
  close(): void;
}

interface OpusEncoder {
  encode(pcm: Float32Array): Uint8Array;
  free(): void;
}

interface Socket {
  send(data: Uint8Array<ArrayBuffer>): void;
  recv(): Promise<Uint8Array>;
  close(): void;
}

export function loadWetypeIdentity(file: string): WetypeIdentity | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const { device, uin } = raw as Record<string, unknown>;
    return typeof device === 'string' && device && typeof uin === 'string' && /^[1-9]\d*$/.test(uin)
      ? { device, uin }
      : null;
  } catch {
    return null;
  }
}

export function saveWetypeIdentity(file: string, identity: WetypeIdentity): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(identity));
}

function connectSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${HOST}/`, 'wxws_pb');
    ws.binaryType = 'arraybuffer';
    const inbox: Uint8Array[] = [];
    const waiters: { resolve(data: Uint8Array): void; reject(error: Error): void }[] = [];
    let failure: Error | null = null;
    const fail = (error: Error) => {
      failure ??= error;
      for (const waiter of waiters.splice(0)) waiter.reject(failure);
      reject(failure);
    };
    ws.onopen = () =>
      resolve({
        send: (data) => {
          if (ws.readyState !== WebSocket.OPEN) throw failure ?? new Error('wetype socket closed');
          ws.send(data);
        },
        recv: () => {
          const next = inbox.shift();
          if (next) return Promise.resolve(next);
          if (failure) return Promise.reject(failure);
          return new Promise<Uint8Array>((res, rej) => {
            const waiter = {
              resolve: (data: Uint8Array) => {
                clearTimeout(timer);
                res(data);
              },
              reject: (error: Error) => {
                clearTimeout(timer);
                rej(error);
              },
            };
            const timer = setTimeout(() => {
              waiters.splice(waiters.indexOf(waiter), 1);
              rej(new Error('wetype response timed out'));
            }, RECV_TIMEOUT_MS);
            waiters.push(waiter);
          });
        },
        close: () => ws.close(),
      });
    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(data);
      else inbox.push(data);
    };
    ws.onerror = () => fail(new Error('wetype socket error'));
    ws.onclose = (event) => fail(new Error(`wetype socket closed (${event.code})`));
  });
}

interface RoundtripOptions {
  cmd: number;
  compress?: '1' | '2';
  token?: string;
}

/** 一条 WSS 上的请求/响应严格一问一答，由调用方串行 */
class WetypeClient {
  private task = 0;
  uin = '0';
  device = '';
  private sessionKey: Uint8Array | null = null;
  private serverPublic = '';
  private uinToken = '';

  constructor(private readonly socket: Socket) {}

  private async roundtrip(
    urlPath: string,
    body: Uint8Array,
    { cmd, compress = '1', token = '' }: RoundtripOptions
  ) {
    const dh = cmd === CMD_DH;
    const genUin = cmd === CMD_UIN;
    const task = dh || genUin ? cmd : ++this.task;
    const trace = randomLower(16);
    const md5 = md5Upper(body);
    const ts = String(Date.now());
    const signed = dh
      ? [OS_TYPE, VERSION, PLATFORM, ts, md5, trace, cmd]
      : genUin
        ? [OS_TYPE, VERSION, PLATFORM, ts, md5, token, trace, cmd]
        : [OS_TYPE, VERSION, PLATFORM, cmd, 0, ts, md5, this.uin, trace, task];
    const headers: [string, string][] = [];
    if (token) headers.push(['Kb-GenUinToken', token]);
    headers.push(['Kb-Uin', this.uin]);
    if (dh || genUin) headers.push(['Kb-DeviceCodeRestrictionV2', '1']);
    if (!dh) {
      if (this.sessionKey)
        headers.push(['Kb-SharedKeySuffix', fromUtf8(this.sessionKey).slice(-4)]);
      headers.push(['Kb-CmdId', String(cmd)], ['Kb-SubCmdId', '0']);
    }
    headers.push(
      ['Kb-OsType', OS_TYPE],
      ['Kb-Version', VERSION],
      ['Kb-SystemVersion', '27.0.0'],
      ['Kb-PackageType', '3'],
      ['Use_DebugNet', '0'],
      ['Kb-TimeStamp', ts],
      ['Kb-BodyMd5', md5],
      ['Kb-TraceId', trace],
      ['Kb-TaskId', String(task)],
      ['Kb-Scene', '2'],
      ['Kb-Sign', sha256Upper(signed.join('') + SIGN_KEY)],
      ['Content-Length', String(body.length)],
      ['Kb-CompressionType', compress],
      ['Content-Type', 'application/octet-stream'],
      ['HOST', HOST]
    );
    const http = new PBuf().s(1, 'POST').s(3, urlPath).s(4, '');
    for (const [key, value] of headers) http.m(5, new PBuf().s(1, key).s(2, value));
    http.s(6, body);
    this.socket.send(new PBuf().v(1, 0).v(2, 0).v(3, task).m(5, http).bytes());

    const response = pbBytes(pbParse(await this.socket.recv()), 4);
    const fields = response ? pbParse(response) : [];
    const headersOut: Record<string, string> = {};
    for (const [field, wire, value] of fields) {
      if (field === 5 || wire !== 2) continue;
      try {
        const [key, val] = pbParse(value as Uint8Array);
        if (key?.[1] === 2 && val?.[1] === 2) {
          headersOut[fromUtf8(key[2] as Uint8Array)] = fromUtf8(val[2] as Uint8Array);
        }
      } catch {}
    }
    return {
      status: pbVarint(fields, 2),
      headers: headersOut,
      body: pbBytes(fields, 5) ?? new Uint8Array(0),
    };
  }

  private async request(urlPath: string, body: Uint8Array, options: RoundtripOptions) {
    const r = await this.roundtrip(urlPath, body, options);
    if (r.status !== 200n || !r.body.length) {
      throw new Error(`wetype ${urlPath} status ${r.status}: ${fromUtf8(r.body).slice(0, 80)}`);
    }
    return r;
  }

  private async exchangeKey(needUin: boolean): Promise<void> {
    const { privateKey, publicHex } = generateKeyPair();
    const req = new PBuf().s(1, publicHex).s(2, publicHex);
    if (needUin) req.v(3, 1);
    req.s(4, this.device);
    if (!needUin) req.v(5, BigInt(this.uin));
    req.s(7, '').s(8, DEVICE_MODEL).s(9, '');
    const r = await this.request('/oauth_pubkey_v2', aesEncrypt(BOOT_KEY, req.bytes()), {
      cmd: CMD_DH,
    });
    const fields = pbParse(aesDecrypt(BOOT_KEY, r.body));
    const server = pbBytes(fields, 2);
    const token = pbBytes(fields, 4);
    if (!server || (needUin && !token)) throw new Error('wetype key exchange incomplete');
    this.serverPublic = fromUtf8(server);
    this.uinToken = token ? fromUtf8(token) : '';
    this.sessionKey = utf8(hexUpper(ecdhSharedX(privateKey, this.serverPublic)));
  }

  private async register(): Promise<void> {
    this.uin = '0';
    this.device = generateDeviceCode();
    await this.exchangeKey(true);
    const req = new PBuf().s(1, this.device).s(2, this.serverPublic).s(4, this.uinToken).bytes();
    const r = await this.request('/gen_uin_v2', aesEncrypt(this.key(), req), {
      cmd: CMD_UIN,
      token: this.uinToken,
    });
    const uin = pbVarint(pbParse(aesDecrypt(this.key(), r.body)), 2);
    if (!uin) throw new Error('wetype issued no UIN');
    this.uin = uin.toString();
  }

  private key(): Uint8Array {
    if (!this.sessionKey) throw new Error('wetype session key missing');
    return this.sessionKey;
  }

  /** 有已登记身份就复用，否则（或复用失败）现场申请 UIN */
  async handshake(identity: WetypeIdentity | null): Promise<WetypeIdentity> {
    await this.roundtrip('/timestamp', new Uint8Array(0), { cmd: 0 });
    if (identity) {
      this.device = identity.device;
      this.uin = identity.uin;
      try {
        await this.exchangeKey(false);
      } catch {
        await this.register();
      }
    } else {
      await this.register();
    }
    await this.notify();
    return { device: this.device, uin: this.uin };
  }

  async notify(): Promise<void> {
    await this.roundtrip('/api_v2', aesEncrypt(this.key(), new Uint8Array(0)), {
      cmd: CMD_NOTIFY,
    });
  }

  async voice(packet: WetypeVoicePacket): Promise<{ text: string; polished: string }> {
    // 语音请求一律 snappy
    const body = aesEncrypt(this.key(), snappyCompress(buildVoiceRequest(packet)));
    const r = await this.request('/api_v2', body, { cmd: CMD_VOICE, compress: '2' });
    let plain = aesDecrypt(this.key(), r.body);
    if ((r.headers['Kb-CompressionType'] ?? r.headers.CompressionType) === '2') {
      plain = snappyDecompress(plain);
    }
    return parseVoiceResponse(plain);
  }
}

/** 建连 + 握手；身份在服务端签发后落盘，下次复用同一 UIN */
export async function openWetypeChannel(identityFile: string): Promise<WetypeVoiceChannel> {
  const socket = await connectSocket();
  try {
    const client = new WetypeClient(socket);
    const previous = loadWetypeIdentity(identityFile);
    const identity = await client.handshake(previous);
    if (identity.uin !== previous?.uin || identity.device !== previous.device) {
      saveWetypeIdentity(identityFile, identity);
    }
    return {
      send: (packet) => client.voice(packet),
      close: () => socket.close(),
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}

async function createOpusEncoder(): Promise<OpusEncoder> {
  const { Application, createEncoder } = await import('libopus-wasm');
  const encoder = await createEncoder({
    sampleRate: 16_000,
    channels: 1,
    application: Application.Audio,
    bitrate: 64_000,
    frameSize: FRAME,
  });
  return { encode: (pcm) => encoder.encodeFloat(pcm), free: () => encoder.free() };
}

/**
 * 微信输入法云端识别：16kHz PCM → Opus 20ms 帧 → 每 6 帧一个请求；
 * 响应带当前累计文本，松手后以空包轮询整理过的定稿。握手期间的音频由 service 的串行链排队。
 */
export function openWetypeStream(options: {
  openChannel: () => Promise<WetypeVoiceChannel>;
  createEncoder?: () => Promise<OpusEncoder>;
  pollIntervalMs?: number;
}): SpeechEngineStream {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const channelReady = options.openChannel();
  const encoderReady = (options.createEncoder ?? createOpusEncoder)();
  const ready = Promise.all([channelReady, encoderReady]);
  // 未被 accept 消费时（立即 cancel）也不留未处理拒绝
  ready.catch(() => {});
  const voiceId = randomUUID().replaceAll('-', '');
  let pending = new Float32Array(0);
  const packets: Uint8Array[] = [];
  let seq = 0;
  let totalBytes = 0;
  let text = '';
  let polished = '';
  let cancelled = false;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    // 分别释放：一方失败时另一方（连接可能回池）也要归还
    void channelReady.then(
      (channel) => channel.close(),
      () => {}
    );
    void encoderReady.then(
      (encoder) => encoder.free(),
      () => {}
    );
  };
  const send = async (channel: WetypeVoiceChannel, packet: WetypeVoicePacket) => {
    const reply = await channel.send(packet);
    if (reply.text) text = reply.text;
    if (reply.polished) polished = reply.polished;
  };
  const upload = async (channel: WetypeVoiceChannel, batch: Uint8Array[], isEnd: boolean) => {
    seq++;
    const framed = frameOpusPackets(batch);
    const opus = seq === 1 ? concatBytes(OPUS_HEADER, framed) : framed;
    totalBytes += opus.length;
    await send(channel, { voiceId, opus, seq, totalBytes, isEnd });
  };
  const encode = (encoder: OpusEncoder, samples: Float32Array) => {
    const all = new Float32Array(pending.length + samples.length);
    all.set(pending);
    all.set(samples, pending.length);
    let offset = 0;
    for (; offset + FRAME <= all.length; offset += FRAME) {
      packets.push(encoder.encode(all.subarray(offset, offset + FRAME)));
    }
    pending = all.slice(offset);
  };
  const live = async () => {
    if (cancelled) throw new Error('cancelled');
    const result = await ready;
    if (cancelled) throw new Error('cancelled');
    return result;
  };

  return {
    accept: async (samples) => {
      const [channel, encoder] = await live();
      encode(encoder, samples);
      while (packets.length >= PACKETS_PER_REQUEST) {
        await upload(channel, packets.splice(0, PACKETS_PER_REQUEST), false);
      }
      return text;
    },
    finish: async () => {
      try {
        const [channel, encoder] = await live();
        if (pending.length) encode(encoder, new Float32Array(FRAME - pending.length));
        while (packets.length > PACKETS_PER_REQUEST) {
          await upload(channel, packets.splice(0, PACKETS_PER_REQUEST), false);
        }
        await upload(channel, packets.splice(0), true);
        for (let i = 0; i < MAX_POLLS && !polished; i++) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          await send(channel, { voiceId, seq: 0, totalBytes, isEnd: true });
        }
        return polished || text;
      } finally {
        release();
      }
    },
    cancel: () => {
      cancelled = true;
      release();
    },
  };
}
