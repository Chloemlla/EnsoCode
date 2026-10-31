import { describe, expect, it, vi } from 'vitest';
import { createPluginTools, PluginToolInvoker } from './pluginTools';

const identity = { sessionId: 's1', generation: '11111111-1111-4111-8111-111111111111' };
const descriptor = {
  name: 'plugin_example-demo__lookup',
  description: '查询',
  parameters: { type: 'object', properties: { q: { type: 'string' } } },
  pluginId: 'example.demo',
};

describe('PluginToolInvoker', () => {
  it('Main 回落结果后 resolve', async () => {
    const emit = vi.fn();
    const invoker = new PluginToolInvoker(identity, emit, { emitCancel: vi.fn() });
    const pending = invoker.invoke('plugin_example-demo__lookup', { q: 'x' });
    const request = emit.mock.calls[0]?.[0];
    expect(request).toMatchObject({ toolName: 'plugin_example-demo__lookup', args: { q: 'x' } });
    invoker.resolve({ requestId: request.requestId, ok: true, result: { content: 'hi' } });
    await expect(pending).resolves.toEqual({ content: 'hi' });
  });

  it('中止时本地失败并通知 Main 取消', async () => {
    const emitCancel = vi.fn();
    const invoker = new PluginToolInvoker(identity, vi.fn(), { emitCancel });
    const controller = new AbortController();
    const pending = invoker.invoke('t', {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(emitCancel).toHaveBeenCalledTimes(1);
  });

  it('超时本地失败并通知取消；晚到结果被忽略', async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const emitCancel = vi.fn();
    const invoker = new PluginToolInvoker(identity, emit, { emitCancel, timeoutMs: 100 });
    const pending = invoker.invoke('t', {});
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(emitCancel).toHaveBeenCalled();
    expect(invoker.resolve({ requestId: emit.mock.calls[0]?.[0].requestId, ok: true })).toBe(false);
    vi.useRealTimers();
  });

  it('cancelAll 让所有挂起调用失败', async () => {
    const invoker = new PluginToolInvoker(identity, vi.fn(), {});
    const a = invoker.invoke('t', {});
    const b = invoker.invoke('t', {});
    invoker.cancelAll();
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    expect(invoker.pendingCount).toBe(0);
  });
});

describe('createPluginTools', () => {
  it('按描述生成工具，执行结果转成文本内容并保留 details', async () => {
    const invoker = { invoke: vi.fn(async () => ({ content: 'hi', details: { n: 1 } })) };
    const [tool] = createPluginTools([descriptor], invoker as never);
    expect(tool).toMatchObject({
      name: descriptor.name,
      description: '查询',
      parameters: descriptor.parameters,
    });
    const result = await tool?.execute(
      'call-1',
      { q: 'x' },
      undefined,
      undefined,
      undefined as never
    );
    expect(invoker.invoke).toHaveBeenCalledWith(descriptor.name, { q: 'x' }, undefined);
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }], details: { n: 1 } });
  });
});
