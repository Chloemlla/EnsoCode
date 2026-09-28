import { describe, expect, it } from 'vitest';
import {
  type GeminiConnect,
  geminiApiKeyFromSettings,
  openGeminiLiveStream,
  parseVocabulary,
} from './gemini';

function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  let handlers!: Parameters<GeminiConnect>[1];
  let url = '';
  let closed = false;
  const connect: GeminiConnect = (target, on) => {
    url = target;
    handlers = on;
    return {
      send: (data) => sent.push(JSON.parse(data)),
      close: () => {
        closed = true;
      },
    };
  };
  const reply = (message: unknown) =>
    handlers.message(new TextEncoder().encode(JSON.stringify(message)).buffer);
  return {
    connect,
    sent,
    reply,
    open: () => handlers.open(),
    drop: (reason = '') => handlers.close(reason),
    url: () => url,
    closed: () => closed,
  };
}

describe('geminiApiKeyFromSettings', () => {
  it('reads the trimmed key from the voice settings only', () => {
    expect(geminiApiKeyFromSettings({ voiceGeminiApiKey: '  AIza-key \n' })).toBe('AIza-key');
    expect(
      geminiApiKeyFromSettings({
        providers: [{ api: 'google-generative-ai', apiKey: 'provider-key', enabled: true }],
      })
    ).toBeNull();
  });

  it('tolerates dirty settings', () => {
    expect(geminiApiKeyFromSettings({})).toBeNull();
    expect(geminiApiKeyFromSettings({ voiceGeminiApiKey: '   ' })).toBeNull();
    expect(geminiApiKeyFromSettings({ voiceGeminiApiKey: 42 })).toBeNull();
  });
});

describe('parseVocabulary', () => {
  it('splits lines and commas, trims and dedupes', () => {
    expect(parseVocabulary(' useEffect\nholdScope, pnpm，useEffect\n\n')).toEqual([
      'useEffect',
      'holdScope',
      'pnpm',
    ]);
  });

  it('caps the list and ignores non-strings', () => {
    expect(parseVocabulary(Array.from({ length: 150 }, (_, i) => `w${i}`).join('\n'))).toHaveLength(
      100
    );
    expect(parseVocabulary(undefined)).toEqual([]);
  });
});

describe('openGeminiLiveStream', () => {
  const samples = new Float32Array([0, 0.5, -1]);

  it('sets up push-to-talk transcription and streams PCM sent before the socket opens', async () => {
    const socket = fakeSocket();
    const stream = openGeminiLiveStream({ apiKey: 'k&y', vocabulary: ['pnpm'] }, socket.connect);
    expect(await stream.accept(samples)).toBe('');
    socket.open();
    expect(socket.url()).toContain('BidiGenerateContent?key=k%26y');
    const [setup, start, audio] = socket.sent;
    expect(setup).toEqual({
      setup: {
        model: 'models/gemini-3.5-transcribe-live',
        generationConfig: { responseModalities: ['TEXT'] },
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        inputAudioTranscription: {
          languageCodes: [],
          mode: 'VERBATIM',
          customVocabulary: ['pnpm'],
        },
      },
    });
    expect(start).toEqual({ realtimeInput: { activityStart: {} } });
    const pcm = Buffer.from(
      (audio as { realtimeInput: { audio: { data: string } } }).realtimeInput.audio.data,
      'base64'
    );
    expect([pcm.readInt16LE(0), pcm.readInt16LE(2), pcm.readInt16LE(4)]).toEqual([
      0, 16384, -32768,
    ]);
  });

  it('returns finals plus the pending interim, and resolves finish on generationComplete', async () => {
    const socket = fakeSocket();
    const stream = openGeminiLiveStream({ apiKey: 'k', vocabulary: [] }, socket.connect);
    socket.open();
    socket.reply({ serverContent: { interimInputTranscription: { text: '今天' } } });
    expect(await stream.accept(samples)).toBe('今天');
    socket.reply({ serverContent: { inputTranscription: { text: '今天开会。' } } });
    socket.reply({ serverContent: { interimInputTranscription: { text: '请' } } });
    expect(await stream.accept(samples)).toBe('今天开会。请');
    const done = stream.finish();
    expect(socket.sent.at(-1)).toEqual({ realtimeInput: { activityEnd: {} } });
    socket.reply({ serverContent: { inputTranscription: { text: '请准备材料。' } } });
    socket.reply({ serverContent: { generationComplete: true } });
    expect(await done).toBe('今天开会。请准备材料。');
    expect(socket.closed()).toBe(true);
  });

  it('resolves an empty transcript when a silent recording only gets ACTIVITY_END', async () => {
    const socket = fakeSocket();
    const stream = openGeminiLiveStream({ apiKey: 'k', vocabulary: [] }, socket.connect);
    socket.open();
    socket.reply({ serverContent: {}, voiceActivity: { type: 'ACTIVITY_END' } });
    await stream.accept(samples);
    expect(socket.closed()).toBe(false);
    const done = stream.finish();
    socket.reply({ serverContent: {}, voiceActivity: { type: 'ACTIVITY_END' } });
    expect(await done).toBe('');
    expect(socket.closed()).toBe(true);
  });

  it('fails when the server closes before the transcript is complete', async () => {
    const socket = fakeSocket();
    const stream = openGeminiLiveStream({ apiKey: 'bad', vocabulary: [] }, socket.connect);
    socket.open();
    socket.drop('API key not valid');
    await expect(stream.accept(samples)).rejects.toThrow('API key not valid');
    await expect(stream.finish()).rejects.toThrow('API key not valid');
  });

  it('cancel closes the socket without sending activityEnd', () => {
    const socket = fakeSocket();
    const stream = openGeminiLiveStream({ apiKey: 'k', vocabulary: [] }, socket.connect);
    socket.open();
    stream.cancel();
    expect(socket.closed()).toBe(true);
    expect(socket.sent.some((m) => JSON.stringify(m).includes('activityEnd'))).toBe(false);
  });
});
