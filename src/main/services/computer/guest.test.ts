import { describe, expect, it } from 'vitest';
import { FakeDesktopBackend } from './fakeBackend';
import { createComputerGuestSession, runComputerGuest } from './guest';

async function run(code: string, opts: { readOnly?: boolean; backend?: FakeDesktopBackend } = {}) {
  const backend = opts.backend ?? new FakeDesktopBackend();
  const result = await runComputerGuest({
    code,
    readOnly: opts.readOnly === true,
    timeoutMs: 10_000,
    backend,
    session: createComputerGuestSession(),
    settleMs: 0,
  });
  return { result, backend };
}

describe('runComputerGuest', () => {
  it('列出窗口并返回值', async () => {
    const { result } = await run(`return await desktop.windows({ app: 'Safari' })`);
    expect(result.returnValue).toEqual([
      expect.objectContaining({ id: 'w1', app: 'Safari', title: 'Settings' }),
    ]);
  });

  it('read_only 拦截 click，允许 ax', async () => {
    await expect(
      run(`const win = await desktop.window({ app: 'Safari' }); await win.click(1, 1)`, {
        readOnly: true,
      })
    ).rejects.toThrow(/read-only/);
    const { result } = await run(`const win = await desktop.window('w1'); return await win.ax()`, {
      readOnly: true,
    });
    expect(String(result.returnValue)).toMatch(/\[ref=e/);
  });

  it('截图后才能点，坐标按缩放映回源尺寸', async () => {
    const backend = new FakeDesktopBackend();
    const { result } = await run(
      `
        const win = await desktop.window('w1');
        await win.screenshot();
        return await win.click(10, 5);
      `,
      { backend }
    );
    expect(backend.clicks[0]).toEqual({
      target: 'w1',
      x: 20,
      y: 10,
      delivery: 'foreground',
    });
    expect(result.returnValue).toMatchObject({ clickSpace: 'w1', x: 10, y: 5 });
  });

  it('未截图就 click 抛 FrameError', async () => {
    await expect(
      run(`const win = await desktop.window('w1'); await win.click(1, 1)`)
    ).rejects.toThrow(/screenshot/);
  });

  it('assert 失败、clipboard 写', async () => {
    await expect(run(`assert(false, 'nope')`)).rejects.toThrow(/nope/);
    const written = await run(
      `await desktop.clipboard.write('hi'); return await desktop.clipboard.read()`,
      {
        backend: new FakeDesktopBackend(),
      }
    );
    expect(written.result.returnValue).toBe('hi');
  });

  it('windows() 元素带 ax/raise，focused 是 focusedWindow 别名', async () => {
    const { result } = await run(`
      const wins = await desktop.windows();
      const focused = await desktop.focused();
      return {
        ax: typeof wins[0].ax,
        raise: typeof wins[0].raise,
        focusedId: focused.id,
        focusedAx: typeof focused.ax,
      };
    `);
    expect(result.returnValue).toEqual({
      ax: 'function',
      raise: 'function',
      focusedId: 'w1',
      focusedAx: 'function',
    });
  });

  it('window("Safari") 按 app 匹配，同 app 多窗口取 focused', async () => {
    const backend = new FakeDesktopBackend();
    backend.windowsList.push({
      id: 'w2',
      app: 'Safari',
      title: 'Other',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const { result } = await run(`return (await desktop.window('Safari')).id`, { backend });
    expect(result.returnValue).toBe('w1');
  });

  it('WeChat 别名命中微信', async () => {
    const backend = new FakeDesktopBackend();
    backend.windowsList = [
      {
        id: 'wx',
        app: '微信',
        title: '微信',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
    ];
    const { result } = await run(`return (await desktop.window({ app: 'WeChat' })).id`, {
      backend,
    });
    expect(result.returnValue).toBe('wx');
  });

  it('空 AX 树说明不可用，而不是空字符串', async () => {
    const backend = new FakeDesktopBackend();
    backend.axSnapshot = async () => [];
    const { result } = await run(`const win = await desktop.window('w1'); return await win.ax()`, {
      backend,
      readOnly: true,
    });
    expect(String(result.returnValue)).toMatch(/ax-empty/);
  });

  it('AX 超时返回 ax-timeout，而不是一直挂起', async () => {
    const backend = new FakeDesktopBackend();
    backend.axSnapshot = async () => {
      throw new Error('AX_TIMEOUT');
    };
    const { result } = await run(`const win = await desktop.window('w1'); return await win.ax()`, {
      backend,
      readOnly: true,
    });
    expect(String(result.returnValue)).toMatch(/timeout/);
  });

  it('clipboard 是对象，raise 后 window() 的 focused 仍为 true', async () => {
    const backend = new FakeDesktopBackend();
    backend.windowsList[0] = { ...backend.windowsList[0], focused: false };
    const { result } = await run(
      `
      await desktop.clipboard.write('hi');
      await desktop.clipboard().write('via-call');
      const win = await desktop.window('w1');
      const raised = await win.raise();
      const again = await desktop.window('w1');
      await win.screenshot();
      const clicked = await win.click(10, 5);
      const typed = await win.type('你好');
      const scrolled = await win.scroll(10, 5, { dy: 40 });
      const scrolledPos = await win.scroll(10, 5, 0, 24);
      const pressed = await win.press('Escape');
      return {
        clipType: typeof desktop.clipboard,
        read: await desktop.clipboard().read(),
        focused: raised.focused,
        againFocused: again.focused,
        clicked,
        typed,
        scrolled,
        scrolledPos,
        pressed,
      };
    `,
      { backend }
    );
    expect(result.returnValue).toMatchObject({
      clipType: 'function',
      read: 'via-call',
      focused: true,
      againFocused: true,
      clicked: expect.objectContaining({
        ok: true,
        x: 10,
        y: 5,
        delivery: 'foreground',
        pixelsChanged: expect.any(Boolean),
      }),
      typed: expect.objectContaining({ ok: true, chars: 2 }),
      scrolled: expect.objectContaining({ ok: true, dy: 40, pixelsChanged: expect.any(Boolean) }),
      scrolledPos: expect.objectContaining({ ok: true, dx: 0, dy: 24 }),
      pressed: expect.objectContaining({ ok: true, keys: ['Escape'] }),
    });
  });

  it('silent 截图 metadata 带 scale', async () => {
    const { result } = await run(
      `const win = await desktop.window('w1'); return await win.screenshot({ silent: true })`
    );
    expect(result.returnValue).toMatchObject({
      width: 100,
      height: 50,
      sourceWidth: 200,
      sourceHeight: 100,
      scale: 2,
      target: 'w1',
    });
    expect(result.screenshots).toEqual([]);
  });

  it('click/axClick 后自动 settle，ax 和 screenshot 不会', async () => {
    const sleeps: number[] = [];
    const backend = new FakeDesktopBackend();
    await runComputerGuest({
      code: `
        const win = await desktop.window('w1');
        await win.ax();
        await win.screenshot();
        await win.click(10, 5);
        const el = await win.ref('e1');
        await el.click();
      `,
      readOnly: false,
      timeoutMs: 10_000,
      backend,
      session: createComputerGuestSession(),
      settleMs: 400,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([400, 400]);
  });

  it('getState 一次返回 AX 文本和截图', async () => {
    const { result } = await run(
      `const win = await desktop.window('w1'); return await win.getState()`
    );
    expect(result.returnValue).toMatchObject({
      width: 100,
      height: 50,
      scale: 2,
      target: 'w1',
    });
    expect(String((result.returnValue as { ax: string }).ax)).toMatch(/\[ref=e/);
    expect(result.screenshots).toHaveLength(1);
  });

  it('desktop.app 已有窗口不 launch', async () => {
    const backend = new FakeDesktopBackend();
    const { result } = await run(`return (await desktop.app('Safari')).id`, { backend });
    expect(result.returnValue).toBe('w1');
    expect(backend.launches).toEqual([]);
  });

  it('desktop.app 没有窗口则 launch 再返回', async () => {
    const backend = new FakeDesktopBackend();
    backend.windowsList = [];
    const { result } = await run(`return (await desktop.app('Finder')).id`, { backend });
    expect(result.returnValue).toBe('launched');
    expect(backend.launches).toEqual(['Finder']);
  });

  it('desktop.app pane 传给 launchApp', async () => {
    const backend = new FakeDesktopBackend();
    backend.windowsList = [];
    await run(`await desktop.app('系统设置', { pane: '外观' })`, { backend });
    expect(backend.launches).toEqual(['系统设置']);
    expect(backend.panes).toEqual(['外观']);
  });

  it('鉴权框停手，不再继续点', async () => {
    const backend = new FakeDesktopBackend();
    backend.windowsList = [
      {
        id: 'auth',
        app: '系统设置',
        title: '锁屏正在尝试修改系统设置',
        pid: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        focused: true,
      },
    ];
    await expect(
      run(
        `
          const win = await desktop.window('auth');
          await win.screenshot();
          await win.click(10, 5);
        `,
        { backend }
      )
    ).rejects.toThrow(/Touch ID or a password/);
  });

  it('read_only 下 app 只解析已有窗口', async () => {
    const { result } = await run(`return (await desktop.app('Safari')).id`, { readOnly: true });
    expect(result.returnValue).toBe('w1');
    const backend = new FakeDesktopBackend();
    backend.windowsList = [];
    await expect(run(`await desktop.app('Finder')`, { readOnly: true, backend })).rejects.toThrow(
      /read-only/
    );
  });

  it('wait 可被 abort 打断', async () => {
    const ac = new AbortController();
    const pending = runComputerGuest({
      code: 'await wait(8000); return 1',
      readOnly: false,
      timeoutMs: 10_000,
      backend: new FakeDesktopBackend(),
      session: createComputerGuestSession(),
      settleMs: 0,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 20);
    await expect(pending).rejects.toThrow(/abort/);
  });
});
