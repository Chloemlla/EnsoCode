import { pixelFingerprint } from '@shared/computer/frame';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../approval';
import { ComputerInvoker, createComputerTool, withComputerApproval } from './computer';

const identity = { sessionId: 's1', generation: '11111111-1111-4111-8111-111111111111' };

describe('ComputerInvoker', () => {
  it('发 computer-invoke 并等 result', async () => {
    const emit = vi.fn();
    const invoker = new ComputerInvoker(identity, emit);
    const pending = invoker.invoke('run', { code: 'return 1' });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ identity, op: 'run', params: { code: 'return 1' } })
    );
    const requestId = emit.mock.calls[0]?.[0]?.requestId as string;
    expect(invoker.resolve({ requestId, ok: true, result: { text: '1', screenshots: [] } })).toBe(
      true
    );
    await expect(pending).resolves.toEqual({ text: '1', screenshots: [] });
  });

  it('abort / cancelAll 拒绝收尾', async () => {
    const invoker = new ComputerInvoker(identity, () => {});
    const controller = new AbortController();
    const aborted = invoker.invoke('run', { code: 'x' }, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow(/abort/i);
    const cancelled = invoker.invoke('run', { code: 'x' });
    invoker.cancelAll();
    await expect(cancelled).rejects.toThrow(/cancel/i);
  });
});

describe('createComputerTool', () => {
  it('schema 声明完整类型，缺 code 不发请求', async () => {
    const emit = vi.fn();
    const tool = createComputerTool(new ComputerInvoker(identity, emit));
    expect(tool.name).toBe('computer');
    expect(tool.executionMode).toBe('sequential');
    const properties = (tool.parameters as { properties: Record<string, { type: string }> })
      .properties;
    expect(properties.code.type).toBe('string');
    expect(properties.read_only.type).toBe('boolean');
    expect(properties.timeout.type).toBe('number');
    await expect(tool.execute('c1', {}, undefined, undefined, undefined as never)).rejects.toThrow(
      /code/
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('归一化 JSON 字符串参数后再 invoke；截图变成 image 块', async () => {
    const emit = vi.fn();
    const invoker = new ComputerInvoker(identity, emit);
    const tool = createComputerTool(invoker);
    const pending = tool.execute(
      'c1',
      '{"code":"await desktop.windows()","read_only":true,"timeout":12}',
      undefined,
      undefined,
      undefined as never
    );
    expect(emit.mock.calls[0]?.[0]?.params).toMatchObject({
      code: 'await desktop.windows()',
      readOnly: true,
      timeoutSec: 12,
    });
    invoker.resolve({
      requestId: emit.mock.calls[0]?.[0]?.requestId as string,
      ok: true,
      result: {
        text: 'ok',
        screenshots: [
          {
            mimeType: 'image/png',
            data: 'AAAA',
            width: 10,
            height: 10,
            sourceWidth: 10,
            sourceHeight: 10,
            target: 'desktop',
          },
        ],
      },
    });
    const out = await pending;
    expect(out.content).toEqual([
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      {
        type: 'text',
        text: `desktop 10×10 (source 10×10, scale 1.00 hash ${pixelFingerprint('AAAA')}). click(x,y) uses these screenshot pixels.\nok`,
      },
    ]);
  });
});

describe('withComputerApproval', () => {
  it('read_only 跳过审批，写操作走 command', async () => {
    const emit = vi.fn();
    const invoker = new ComputerInvoker(identity, emit);
    const onRequest = vi.fn();
    const gate = new ApprovalGate('supervised', onRequest, () => {});
    const tool = withComputerApproval(gate, createComputerTool(invoker));

    const readPending = tool.execute(
      'c1',
      { code: 'await desktop.windows()', read_only: true },
      undefined,
      undefined,
      undefined as never
    );
    invoker.resolve({
      requestId: emit.mock.calls[0]?.[0]?.requestId as string,
      ok: true,
      result: { text: '[]', screenshots: [] },
    });
    await readPending;
    expect(onRequest).not.toHaveBeenCalled();

    const write = tool.execute(
      'c2',
      { code: 'await win.click(1,1)' },
      undefined,
      undefined,
      undefined as never
    );
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'computer', kind: 'command' })
    );
    gate.respond(onRequest.mock.calls[0]?.[0]?.requestId as string, 'deny');
    await expect(write).rejects.toThrow(/denied/i);
  });
});
