import { describe, expect, it } from 'vitest';
import {
  aesDecrypt,
  aesEncrypt,
  buildVoiceRequest,
  ecdhSharedX,
  frameOpusPackets,
  generateDeviceCode,
  generateKeyPair,
  md5Upper,
  PBuf,
  parseVoiceResponse,
  pbParse,
  snappyCompress,
  snappyDecompress,
} from './wetypeProtocol';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('wetype protocol', () => {
  it('round-trips protobuf varints above 32 bits and length-delimited fields', () => {
    const wire = new PBuf().v(1, 8848109380590273n).s(2, '你好').bytes();
    const [uin, text] = pbParse(wire);
    expect(uin).toEqual([1, 0, 8848109380590273n]);
    expect(text[0]).toBe(2);
    expect(new TextDecoder().decode(text[2] as Uint8Array)).toBe('你好');
  });

  it('decompresses its own snappy output and back-references', () => {
    const data = bytes(`${'x'.repeat(200)}tail`);
    expect(snappyDecompress(snappyCompress(data))).toEqual(data);
    // 字面量 "ab" + 拷贝 offset=2 len=4 → "ababab"
    expect(snappyDecompress(Uint8Array.of(6, 0x04, 0x61, 0x62, 0x01, 0x02))).toEqual(
      bytes('ababab')
    );
  });

  it('encrypts with AES-256-ECB/PKCS7 using a 32-char ASCII key', () => {
    const key = bytes('D4Y5U3Y2M0C0T7N4P1P7O2N6E1I2Y1U6');
    const cipher = aesEncrypt(key, bytes('hello'));
    expect(cipher.length).toBe(16);
    expect(aesDecrypt(key, cipher)).toEqual(bytes('hello'));
    expect(aesEncrypt(key, new Uint8Array(0)).length).toBe(16);
  });

  it('agrees on the same secp128r1 shared secret from both sides', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.publicHex).toMatch(/^04[0-9A-F]{64}$/);
    expect(ecdhSharedX(a.privateKey, b.publicHex)).toEqual(ecdhSharedX(b.privateKey, a.publicHex));
  });

  it('signs device codes with the MD5 of body plus sign key', () => {
    const device = generateDeviceCode();
    expect(device).toMatch(/^MAC0{9}Mac16,12[a-z]{12}[0-9A-F]{32}$/);
    expect(device.slice(-32)).toBe(md5Upper(bytes(`${device.slice(0, -32)}zN7rB3bL4pO8jW1o`)));
  });

  it('frames opus packets with little-endian u16 lengths', () => {
    expect(frameOpusPackets([Uint8Array.of(9), new Uint8Array(258)]).subarray(0, 6)).toEqual(
      Uint8Array.of(1, 0, 9, 2, 1, 0)
    );
  });

  it('parses the streaming text and polished text of a voice response', () => {
    const request = buildVoiceRequest({ voiceId: 'v', seq: 0, totalBytes: 3, isEnd: true });
    const inner = pbParse(pbParse(request)[0][2] as Uint8Array);
    expect(inner.map(([field]) => field)).toEqual([2, 5, 6, 7, 11, 22, 23, 24]);
    const response = new PBuf()
      .m(1, new PBuf().s(2, 'v').v(3, 102302).s(4, '你好。').s(14, '你好！'))
      .bytes();
    expect(parseVoiceResponse(response)).toEqual({ text: '你好。', polished: '你好！' });
  });
});
