import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';

/** 微信输入法（WeType）语音通道的线上格式：protobuf + snappy + AES-256-ECB + secp128r1 ECDH */

export const SIGN_KEY = 'zN7rB3bL4pO8jW1o';
const DEVICE_MODEL = 'Mac16,12';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const fromUtf8 = (data: Uint8Array): string => decoder.decode(data);

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.concat(parts));
}

export const hexUpper = (data: Uint8Array): string =>
  Buffer.from(data).toString('hex').toUpperCase();
export const md5Upper = (data: Uint8Array): string =>
  hexUpper(createHash('md5').update(data).digest());
export const sha256Upper = (text: string): string =>
  hexUpper(createHash('sha256').update(text).digest());

export function randomLower(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(97 + randomInt(26));
  return out;
}

export function generateDeviceCode(): string {
  const body = `MAC${DEVICE_MODEL.padStart(17, '0')}${randomLower(12)}`;
  return body + md5Upper(utf8(body + SIGN_KEY));
}

// ---- protobuf ----

function uvarint(value: number | bigint): Uint8Array {
  let n = BigInt(value);
  const out: number[] = [];
  while (n >= 0x80n) {
    out.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  out.push(Number(n));
  return Uint8Array.from(out);
}

function readVarint(buf: Uint8Array, start: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let i = start;
  for (;;) {
    if (i >= buf.length) throw new Error('truncated varint');
    const b = buf[i++];
    value |= BigInt(b & 0x7f) << shift;
    if (b < 0x80) return [value, i];
    shift += 7n;
  }
}

export class PBuf {
  private readonly parts: Uint8Array[] = [];
  v(field: number, value: number | bigint): this {
    this.parts.push(uvarint(BigInt(field) << 3n), uvarint(value));
    return this;
  }
  s(field: number, value: string | Uint8Array): this {
    const raw = typeof value === 'string' ? utf8(value) : value;
    this.parts.push(uvarint((BigInt(field) << 3n) | 2n), uvarint(raw.length), raw);
    return this;
  }
  m(field: number, sub: PBuf): this {
    return this.s(field, sub.bytes());
  }
  bytes(): Uint8Array<ArrayBuffer> {
    return concatBytes(...this.parts);
  }
}

export type PbField = [field: number, wireType: number, value: bigint | Uint8Array];

export function pbParse(buf: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  while (i < buf.length) {
    const [tag, next] = readVarint(buf, i);
    i = next;
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      const [value, after] = readVarint(buf, i);
      out.push([field, wire, value]);
      i = after;
    } else if (wire === 2 || wire === 1 || wire === 5) {
      let length = wire === 1 ? 8 : 4;
      if (wire === 2) {
        const [n, after] = readVarint(buf, i);
        length = Number(n);
        i = after;
      }
      if (i + length > buf.length) throw new Error('truncated field');
      out.push([field, wire, buf.subarray(i, i + length)]);
      i += length;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

export function pbBytes(fields: PbField[], field: number): Uint8Array | null {
  const hit = fields.find(([f, wire]) => f === field && wire === 2);
  return hit ? (hit[2] as Uint8Array) : null;
}

export function pbVarint(fields: PbField[], field: number): bigint | null {
  const hit = fields.find(([f, wire]) => f === field && wire === 0);
  return hit ? (hit[2] as bigint) : null;
}

// ---- snappy（上行只发字面量块，下行需完整解码）----

export function snappyCompress(data: Uint8Array): Uint8Array {
  const parts = [uvarint(data.length)];
  for (let i = 0; i < data.length; i += 60) {
    const chunk = data.subarray(i, i + 60);
    parts.push(Uint8Array.of((chunk.length - 1) << 2), chunk);
  }
  return concatBytes(...parts);
}

export function snappyDecompress(buf: Uint8Array): Uint8Array {
  const [length, start] = readVarint(buf, 0);
  const out = new Uint8Array(Number(length));
  let o = 0;
  let i = start;
  const copy = (offset: number, n: number) => {
    if (offset <= 0 || offset > o || o + n > out.length) throw new Error('bad snappy copy');
    for (let k = 0; k < n; k++, o++) out[o] = out[o - offset];
  };
  while (i < buf.length) {
    const tag = buf[i++];
    const kind = tag & 3;
    if (kind === 0) {
      let n = tag >> 2;
      if (n >= 60) {
        const width = n - 59;
        n = 0;
        for (let k = 0; k < width; k++) n |= buf[i++] << (8 * k);
      }
      n += 1;
      if (i + n > buf.length || o + n > out.length) throw new Error('bad snappy literal');
      out.set(buf.subarray(i, i + n), o);
      i += n;
      o += n;
    } else if (kind === 1) {
      copy(((tag >> 5) << 8) | buf[i++], ((tag >> 2) & 7) + 4);
    } else if (kind === 2) {
      copy(buf[i] | (buf[i + 1] << 8), (tag >> 2) + 1);
      i += 2;
    } else {
      copy(
        (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0,
        (tag >> 2) + 1
      );
      i += 4;
    }
  }
  if (o !== out.length) throw new Error('snappy length mismatch');
  return out;
}

// ---- AES：密钥都是 32 字符 ASCII → AES-256-ECB/PKCS7 ----

export function aesEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const cipher = createCipheriv('aes-256-ecb', key, null);
  return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
}

export function aesDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const decipher = createDecipheriv('aes-256-ecb', key, null);
  return new Uint8Array(Buffer.concat([decipher.update(data), decipher.final()]));
}

// ---- secp128r1 ECDH（Node/BoringSSL 不带此曲线，手写）----

const P = 0xfffffffdffffffffffffffffffffffffn;
const A = 0xfffffffdfffffffffffffffffffffffcn;
const G: Point = [0x161ff7528b899b2d0c28607ca52c5b86n, 0xcf5ac8395bafeb13c02da292dded7a83n];
const N = 0xfffffffe0000000075a30d1b9038a115n;
type Point = [bigint, bigint] | null;

const mod = (x: bigint) => ((x % P) + P) % P;

function inverse(x: bigint): bigint {
  let result = 1n;
  let base = mod(x);
  for (let e = P - 2n; e > 0n; e >>= 1n) {
    if (e & 1n) result = mod(result * base);
    base = mod(base * base);
  }
  return result;
}

function addPoints(p: Point, q: Point): Point {
  if (!p) return q;
  if (!q) return p;
  const [x1, y1] = p;
  const [x2, y2] = q;
  if (x1 === x2 && mod(y1 + y2) === 0n) return null;
  const slope =
    x1 === x2 && y1 === y2
      ? mod((3n * x1 * x1 + A) * inverse(2n * y1))
      : mod((y2 - y1) * inverse(x2 - x1));
  const x3 = mod(slope * slope - x1 - x2);
  return [x3, mod(slope * (x1 - x3) - y1)];
}

function multiply(k: bigint, point: Point): Point {
  let result: Point = null;
  let addend = point;
  for (let n = k; n > 0n; n >>= 1n) {
    if (n & 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
  }
  return result;
}

const toBe16 = (n: bigint) => Buffer.from(n.toString(16).padStart(32, '0'), 'hex');

export function generateKeyPair(): { privateKey: bigint; publicHex: string } {
  let privateKey = 0n;
  while (privateKey === 0n) privateKey = BigInt(`0x${randomBytes(16).toString('hex')}`) % N;
  const point = multiply(privateKey, G);
  if (!point) throw new Error('bad key');
  return { privateKey, publicHex: `04${hexUpper(Buffer.concat(point.map(toBe16)))}` };
}

export function ecdhSharedX(privateKey: bigint, publicHex: string): Uint8Array {
  if (!/^04[0-9a-fA-F]{64}$/.test(publicHex)) throw new Error('bad server public key');
  const point = multiply(privateKey, [
    BigInt(`0x${publicHex.slice(2, 34)}`),
    BigInt(`0x${publicHex.slice(34)}`),
  ]);
  if (!point) throw new Error('bad shared point');
  return new Uint8Array(toBe16(point[0]));
}

// ---- 语音请求 / 响应 ----

/** 每个包前置 u16le 长度 */
export function frameOpusPackets(packets: readonly Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const packet of packets)
    parts.push(Uint8Array.of(packet.length & 0xff, packet.length >> 8), packet);
  return concatBytes(...parts);
}

export function buildVoiceRequest(fields: {
  voiceId: string;
  opus?: Uint8Array;
  seq: number;
  totalBytes: number;
  isEnd: boolean;
}): Uint8Array {
  const inner = new PBuf().s(2, fields.voiceId);
  if (fields.opus?.length) inner.s(4, fields.opus);
  inner.v(5, 5);
  if (fields.isEnd) inner.v(6, 1);
  inner.v(7, fields.seq);
  if (fields.totalBytes) inner.v(11, fields.totalBytes);
  inner.v(22, 1).v(23, 1).v(24, 1);
  return new PBuf().m(1, inner).bytes();
}

/** F4 = 当前累计识别文本，F14 = 结束后整理过的定稿 */
export function parseVoiceResponse(data: Uint8Array): { text: string; polished: string } {
  const fields = pbParse(pbBytes(pbParse(data), 1) ?? data);
  const text = pbBytes(fields, 4);
  const polished = pbBytes(fields, 14);
  return { text: text ? fromUtf8(text) : '', polished: polished ? fromUtf8(polished) : '' };
}
