import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createExploreFoldState,
  createExploreFoldTools,
  exploreFoldExtension,
} from './exploreFold';

const model = getModel('openai', 'gpt-4o-mini');
if (!model) throw new Error('Test model is not available in the bundled Pi catalog.');

const probe: ToolDefinition = {
  name: 'probe',
  label: 'Probe',
  description: 'Side-effect-free exploration tool.',
  parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: 'text', text: 'PROBE-OUTPUT' }], details: undefined }),
};

function reply(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model!.api,
    provider: model!.provider,
    model: model!.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: Date.now(),
  };
}

const toolCall = (id: string, name: string, args: Record<string, string> = {}) =>
  reply([{ type: 'toolCall', id, name, arguments: args }]);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

it('fold 后折叠区间以 context_edit 持久化，pi 投影不再含探索中间轮次', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-explore-fold-'));
  const cwd = path.join(root, 'workspace');
  const agentDir = path.join(root, 'agent');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
    refreshOnCreate: false,
  });
  vi.spyOn(runtime, 'hasConfiguredAuth').mockReturnValue(true);
  const plans = [
    toolCall('m1', 'explore_mark', { goal: 'look' }),
    toolCall('p1', 'probe'),
    toolCall('f1', 'explore_fold', { report: 'REPORT' }),
    reply([{ type: 'text', text: 'done' }]),
  ];
  const requests: TranscriptContext[] = [];
  vi.spyOn(runtime, 'streamSimple').mockImplementation((_model, context) => {
    requests.push(context as TranscriptContext);
    const stream = createAssistantMessageEventStream();
    const message = plans.shift() ?? reply([{ type: 'text', text: 'unexpected' }]);
    stream.push({ type: 'done', reason: message.stopReason as 'stop', message });
    return stream;
  });
  const state = createExploreFoldState();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: 'Explore fold test.',
    extensionFactories: [exploreFoldExtension(state)],
  });
  await resourceLoader.reload();
  const manager = SessionManager.create(cwd, path.join(root, 'sessions'));
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    resourceLoader,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: false },
      compaction: { enabled: false },
    }),
    noTools: 'builtin',
    customTools: [probe, ...createExploreFoldTools(state)],
  });
  cleanups.push(() => {
    session.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  await session.prompt('Explore please.');

  expect(requests).toHaveLength(4);
  const edits = manager.getBranch().filter((entry) => entry.type === 'context_edit');
  expect(edits).toHaveLength(2);
  const projected = JSON.stringify(manager.buildSessionProjection().messages);
  expect(projected).not.toContain('PROBE-OUTPUT');
  expect(projected).not.toContain('"p1"');
  expect(projected).toContain('REPORT');
  expect(JSON.stringify(requests[3]!.messages)).not.toContain('PROBE-OUTPUT');
});
