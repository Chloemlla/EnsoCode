import type { AgentCommand } from '@shared/types/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginMcpRequests } from './mcpRequests';

afterEach(() => vi.useRealTimers());

const servers = [{ name: 'bce', transport: 'stdio' as const, command: 'bce-tool' }];

describe('PluginMcpRequests', () => {
  it('按 requestId 结算列表与调用结果', async () => {
    const sent: AgentCommand[] = [];
    const requests = new PluginMcpRequests((command) => {
      sent.push(command);
      return true;
    });
    const listing = requests.list(servers, new AbortController().signal);
    const list = sent[0];
    if (list?.type !== 'plugin-mcp-list') throw new Error('expected list');
    requests.settle({ type: 'plugin-mcp-result', requestId: list.requestId, ok: true, value: [] });
    await expect(listing).resolves.toEqual([]);

    const calling = requests.call(
      servers,
      'bce',
      'enhance_prompt',
      { prompt: 'x' },
      new AbortController().signal
    );
    const call = sent[1];
    expect(call).toMatchObject({ type: 'plugin-mcp-call', server: 'bce', tool: 'enhance_prompt' });
    if (call?.type !== 'plugin-mcp-call') throw new Error('expected call');
    requests.settle({
      type: 'plugin-mcp-result',
      requestId: call.requestId,
      ok: false,
      error: 'boom',
    });
    await expect(calling).rejects.toMatchObject({ code: 'MCP_ERROR', message: 'boom' });
  });

  it('中止时通知 worker 取消并以 ABORTED 失败，迟到结果丢弃', async () => {
    const sent: AgentCommand[] = [];
    const requests = new PluginMcpRequests((command) => {
      sent.push(command);
      return true;
    });
    const controller = new AbortController();
    const calling = requests.call(servers, 'bce', 'enhance_prompt', {}, controller.signal);
    controller.abort();
    await expect(calling).rejects.toMatchObject({ code: 'ABORTED' });
    const requestId = (sent[0] as { requestId: string }).requestId;
    expect(sent[1]).toEqual({ type: 'plugin-mcp-cancel', requestId });
    expect(requests.settle({ type: 'plugin-mcp-result', requestId, ok: true, value: 'late' })).toBe(
      true
    );
  });

  it('worker 不可用时直接失败；超时也会取消 worker 侧调用', async () => {
    const offline = new PluginMcpRequests(() => false);
    await expect(offline.list(servers, new AbortController().signal)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });

    vi.useFakeTimers();
    const sent: AgentCommand[] = [];
    const requests = new PluginMcpRequests((command) => {
      sent.push(command);
      return true;
    }, 1000);
    const calling = requests.call(servers, 'bce', 'x', {}, new AbortController().signal);
    const assertion = expect(calling).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(sent.at(-1)).toMatchObject({ type: 'plugin-mcp-cancel' });
  });

  it('worker 退出时全部失败', async () => {
    const requests = new PluginMcpRequests(() => true);
    const calling = requests.call(servers, 'bce', 'x', {}, new AbortController().signal);
    requests.failAll('agent worker exited');
    await expect(calling).rejects.toMatchObject({ code: 'MCP_ERROR' });
  });

  it('不是插件 MCP 结果的事件不认领', () => {
    const requests = new PluginMcpRequests(() => true);
    expect(requests.settle({ type: 'workspace-lock-result', requestId: 'x', ok: true })).toBe(
      false
    );
  });
});
