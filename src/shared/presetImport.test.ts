import { describe, expect, it, vi } from 'vitest';
import {
  fetchPresetImport,
  PRESET_IMPORT_MAX_BYTES,
  parsePresetImportBody,
  parsePublicHttpsUrl,
} from './presetImport';

describe('parsePublicHttpsUrl', () => {
  it('只接受无凭据的公网 https', () => {
    expect(parsePublicHttpsUrl('https://example.com/preset.json')?.href).toBe(
      'https://example.com/preset.json'
    );
    expect(parsePublicHttpsUrl('http://example.com/a')).toBeNull();
    expect(parsePublicHttpsUrl('https://user:pass@example.com/a')).toBeNull();
    expect(parsePublicHttpsUrl('https://localhost/a')).toBeNull();
    expect(parsePublicHttpsUrl('https://127.0.0.1/a')).toBeNull();
    expect(parsePublicHttpsUrl('https://192.168.0.5/a')).toBeNull();
    expect(parsePublicHttpsUrl('https://10.0.0.2/a')).toBeNull();
    expect(parsePublicHttpsUrl('https://169.254.169.254/latest')).toBeNull();
    expect(parsePublicHttpsUrl('file:///tmp/a.json')).toBeNull();
  });
});

describe('parsePresetImportBody', () => {
  it('读取文案字段，丢弃远程 skill/MCP id', () => {
    const parsed = parsePresetImportBody(
      JSON.stringify({
        name: 'Pack',
        role: 'You are a reviewer.',
        tail: 'Stay on the task.',
        boost: 'Last block.',
        refusalRetry: true,
        refusalRetryPrompt: 'Continue.',
        skillIds: ['remote-skill'],
        mcpServerIds: ['remote-mcp'],
        instructionId: 'remote-instruction',
        suggestedSkills: ['deploy', 'deploy', ' review '],
        suggestedMcp: ['notes'],
      })
    );
    expect(parsed).toEqual({
      ok: true,
      draft: {
        name: 'Pack',
        role: 'You are a reviewer.',
        tail: 'Stay on the task.',
        boost: 'Last block.',
        refusalRetry: true,
        refusalRetryPrompt: 'Continue.',
        suggestedSkills: ['deploy', 'review'],
        suggestedMcp: ['notes'],
      },
    });
  });

  it('无名、非 JSON、空对象失败', () => {
    expect(parsePresetImportBody('').ok).toBe(false);
    expect(parsePresetImportBody('not json').ok).toBe(false);
    expect(parsePresetImportBody('[]').ok).toBe(false);
    expect(parsePresetImportBody('{"role":"x"}').ok).toBe(false);
  });
});

describe('fetchPresetImport', () => {
  it('跟随公网跳转并解析正文', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://example.com/a') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/pack.json' },
        });
      }
      return new Response(JSON.stringify({ name: 'From URL', role: 'Role' }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(fetchPresetImport('https://example.com/a', fetchImpl)).resolves.toEqual({
      ok: true,
      draft: {
        name: 'From URL',
        role: 'Role',
        tail: '',
        boost: '',
        refusalRetry: false,
        refusalRetryPrompt: '',
        suggestedSkills: [],
        suggestedMcp: [],
      },
    });
  });

  it('跳进内网或超大正文失败', async () => {
    const toPrivate = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } })
    ) as unknown as typeof fetch;
    await expect(fetchPresetImport('https://example.com/a', toPrivate)).resolves.toMatchObject({
      ok: false,
    });
    const huge = vi.fn(
      async () => new Response('x'.repeat(PRESET_IMPORT_MAX_BYTES + 1), { status: 200 })
    ) as unknown as typeof fetch;
    await expect(fetchPresetImport('https://example.com/a', huge)).resolves.toMatchObject({
      ok: false,
    });
  });
});
