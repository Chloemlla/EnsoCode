import { describe, expect, it } from 'vitest';
import {
  acceptCorrection,
  buildCorrectionRequest,
  joinSegments,
  normalizeTranscript,
} from './text';

describe('joinSegments', () => {
  it('adds a space only between two non-CJK edges', () => {
    expect(joinSegments(['你好。', '然后'])).toBe('你好。然后');
    expect(joinSegments(['Hello.', 'World'])).toBe('Hello. World');
    expect(joinSegments(['好的', 'OK'])).toBe('好的OK');
    expect(joinSegments(['', 'a', ''])).toBe('a');
  });
});

describe('normalizeTranscript', () => {
  it('drops the space the transducer puts after CJK punctuation and trims', () => {
    expect(normalizeTranscript(' 部署以后， 用 pm2 重启。 然后看日志 ')).toBe(
      '部署以后，用 pm2 重启。然后看日志'
    );
  });

  it('strips replacement characters from broken byte decoding', () => {
    expect(normalizeTranscript('\uFFFD')).toBe('');
    expect(normalizeTranscript('你好\uFFFD世界')).toBe('你好世界');
  });
});

describe('correction', () => {
  it('wraps the transcript so the model corrects it instead of obeying it', () => {
    const request = buildCorrectionRequest('local:qwen3-1.7b', '帮我写一个 go 的服务');
    expect(request.userText).toContain('帮我写一个 go 的服务');
    expect(request.userText).not.toBe('帮我写一个 go 的服务');
    expect(request.systemPrompt.length).toBeGreaterThan(0);
    expect(request.maxTokens).toBeGreaterThan(20);
  });

  it('feeds the tuned voice model its own prompt and the bare transcript', () => {
    const request = buildCorrectionRequest('local:myvoicetyping-1.5b', '今天天气怎么样');
    expect(request.userText).toBe('今天天气怎么样');
    expect(request.systemPrompt).toContain('ASR');
  });

  it('keeps a plausible correction after stripping wrappers', () => {
    const raw = '把 settings jso n 里面的 voice input enabled 改成 false';
    expect(
      acceptCorrection(
        raw,
        '<think>\n</think>\n```\n把 settings.json 里面的 voiceInputEnabled 改成 false\n```'
      )
    ).toBe('把 settings.json 里面的 voiceInputEnabled 改成 false');
    expect(acceptCorrection('你好', '<transcript>你好。</transcript>')).toBe('你好。');
  });

  it('falls back to the transcript when the model answers or drops content', () => {
    const raw = '帮我写一个 go 的 http 服务';
    expect(acceptCorrection(raw, '')).toBe(raw);
    expect(acceptCorrection(raw, '好的')).toBe(raw);
    expect(
      acceptCorrection(raw, `好的，下面是一个 Go 的 HTTP 服务：\n${'package main\n'.repeat(20)}`)
    ).toBe(raw);
  });
});
