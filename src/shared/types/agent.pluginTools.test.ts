import { describe, expect, it } from 'vitest';
import { parseAgentCommand, parseAgentWorkerEvent } from './agent';

const parent = {
  sessionId: 'conversation-1',
  generation: '11111111-1111-4111-8111-111111111111',
} as const;
const model = {
  api: 'openai-responses',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'k',
  modelId: 'gpt',
  settingsProviderId: 'provider-entry-1',
};
const tool = {
  name: 'plugin_example-demo__lookup',
  description: '查询',
  parameters: { type: 'object' },
  pluginId: 'example.demo',
};
const spawn = (pluginTools: unknown) => ({
  type: 'spawn-parent',
  identity: parent,
  cwd: '/repo',
  model,
  pluginTools,
});

describe('插件工具协议', () => {
  it('spawn-parent 接受合法 pluginTools', () => {
    expect(parseAgentCommand(spawn([tool]))).not.toBeNull();
  });

  it.each([
    ['非数组', 'x'],
    ['名称与插件 id 不符', [{ ...tool, pluginId: 'other.demo' }]],
    ['不是插件工具名', [{ ...tool, name: 'bash' }]],
    ['parameters 非对象', [{ ...tool, parameters: 'x' }]],
    ['多余字段', [{ ...tool, extra: 1 }]],
    ['重名', [tool, tool]],
  ])('spawn-parent 拒绝脏 pluginTools：%s', (_label, value) => {
    expect(parseAgentCommand(spawn(value))).toBeNull();
  });

  it('plugin-tool-result 成功与失败两种形状', () => {
    const base = { type: 'plugin-tool-result', identity: parent, requestId: 'r1' };
    expect(parseAgentCommand({ ...base, ok: true, result: { content: 'x' } })).not.toBeNull();
    expect(parseAgentCommand({ ...base, ok: false, error: 'bad' })).not.toBeNull();
    expect(parseAgentCommand({ ...base, ok: false, result: {} })).toBeNull();
  });

  it('plugin-tool-invoke / cancel 事件', () => {
    const invoke = {
      type: 'plugin-tool-invoke',
      identity: parent,
      seq: 1,
      requestId: 'r1',
      toolName: tool.name,
      args: {},
    };
    expect(parseAgentWorkerEvent(invoke)).not.toBeNull();
    expect(parseAgentWorkerEvent({ ...invoke, toolName: 'bash' })).toBeNull();
    expect(
      parseAgentWorkerEvent({
        type: 'plugin-tool-cancel',
        identity: parent,
        seq: 2,
        requestId: 'r1',
      })
    ).not.toBeNull();
  });
});
