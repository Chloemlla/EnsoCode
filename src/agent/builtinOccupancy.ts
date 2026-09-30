import type { OccupancyTool } from '@shared/occupancy';
import { EMPTY_PLAN_STATE } from '@shared/planMode';
import { BUILTIN_AGENT_TYPES } from '@shared/types';
import type { AgentTypeSpawnConfig, SubagentModelOption } from '@shared/types/agent';
import { AskManager, createAskTool } from './ask';
import { createTaskTools } from './backgroundTasks';
import { createIsolatedSandboxTool } from './isolatedSandbox';
import { createSubmitPlanTool } from './planMode';
import { createUnifiedSubagentTool } from './subagent';
import { createTodoTool } from './todo';
import { BrowserInvoker, createBrowserTools } from './tools/browser';
import { createMemoryTools, MemoryInvoker } from './tools/memory';
import { createWebTools } from './tools/web';

function fields(tool: { name: string; description?: string; parameters?: unknown }): OccupancyTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

const noopIdentity = {
  sessionId: 'occupancy',
  generation: 'occupancy',
};

export function snapshotBuiltinOccupancyTools(input?: {
  agentTypes?: AgentTypeSpawnConfig[];
  models?: SubagentModelOption[];
}): Record<string, OccupancyTool[]> {
  const agentTypes =
    input?.agentTypes ??
    BUILTIN_AGENT_TYPES.map((type) => ({
      name: type.name,
      description: type.description,
      systemPrompt: type.systemPrompt,
      tools: type.tools,
    }));
  const models = input?.models ?? [];
  const ask = new AskManager(
    () => {},
    () => {}
  );
  const browser = new BrowserInvoker(noopIdentity, () => {});
  return {
    subagent: [
      fields(
        createUnifiedSubagentTool({
          agentTypes,
          models,
          invoke: async () => ({ ok: false, code: 'runtime-unavailable', error: 'snapshot' }),
        })
      ),
    ],
    todo: [fields(createTodoTool())],
    plan: [
      fields(createSubmitPlanTool({ state: () => EMPTY_PLAN_STATE, submit: () => {} }, () => '')),
    ],
    ask_user: [fields(createAskTool(ask))],
    browser: createBrowserTools(browser).map(fields),
    web: createWebTools().map(fields),
    memory: createMemoryTools(new MemoryInvoker(noopIdentity, () => {})).map(fields),
    background_tasks: createTaskTools({
      read: async () => undefined,
      stop: () => false,
      knownIds: () => [],
    } as never).map(fields),
    isolated_sandbox: [fields(createIsolatedSandboxTool({ getTools: () => [] }))],
  };
}
