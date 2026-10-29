import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '@platform';
import { DEFAULT_PERSONA_PROMPT } from '../../shared/systemPrompt';
import { isSystemPromptId } from '../../shared/systemPromptId';

export { isSystemPromptId };

export interface SystemPromptResult {
  ok: boolean;
  content: string;
  error?: string;
}

function storeDir(): string {
  return join(app.getPath('userData'), 'system-prompts');
}

function promptFile(id: string): string {
  return join(storeDir(), `${id}.md`);
}

export function readStoredSystemPrompt(id: string): SystemPromptResult {
  if (!isSystemPromptId(id)) return { ok: false, content: '', error: 'Invalid id' };
  try {
    const content = readFileSync(promptFile(id), 'utf8');
    if (!content.trim()) return { ok: false, content: '', error: 'System prompt is empty' };
    return { ok: true, content };
  } catch (error) {
    return {
      ok: false,
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readSystemPrompt(id?: string): Promise<SystemPromptResult> {
  if (id !== undefined) return readStoredSystemPrompt(id);
  return { ok: true, content: DEFAULT_PERSONA_PROMPT };
}

export function writeSystemPrompt(id: string, content: string): { ok: boolean; error?: string } {
  if (!isSystemPromptId(id)) return { ok: false, error: 'Invalid id' };
  if (!content.trim()) return { ok: false, error: 'System prompt cannot be blank' };
  try {
    mkdirSync(storeDir(), { recursive: true });
    writeFileSync(promptFile(id), content, { encoding: 'utf8', mode: 0o600 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function deleteSystemPrompt(id: string): { ok: boolean; error?: string } {
  if (!isSystemPromptId(id)) return { ok: false, error: 'Invalid id' };
  try {
    rmSync(promptFile(id), { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
