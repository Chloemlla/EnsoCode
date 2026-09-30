import { describe, expect, it } from 'vitest';
import { dispatchAxJob } from './axJob';
import { createWinUiaBridge, type WinUiaRaw } from './winUia';

interface FakeEl {
  id: string;
  role: string;
  title?: string;
  value?: string;
  description?: string;
  enabled?: boolean;
  focused?: boolean;
  actions?: string[];
  bounds?: { x: number; y: number; width: number; height: number };
  kids?: FakeEl[];
}

function fakeRaw(root: FakeEl, extras: { at?: FakeEl; focused?: FakeEl } = {}): WinUiaRaw {
  const index = new Map<string, FakeEl>();
  const walk = (node: FakeEl) => {
    index.set(node.id, node);
    for (const kid of node.kids ?? []) walk(kid);
  };
  walk(root);
  if (extras.at) walk(extras.at);
  if (extras.focused) walk(extras.focused);
  const get = (el: unknown) => {
    const node = index.get(String(el));
    if (!node) throw new Error(`missing ${String(el)}`);
    return node;
  };
  return {
    elementFromHandle: (hwnd) => (hwnd === 42 ? root.id : null),
    elementFromPoint: () => extras.at?.id ?? null,
    focused: () => extras.focused?.id ?? null,
    children: (el) => (get(el).kids ?? []).map((kid) => kid.id),
    describe: (el) => {
      const node = get(el);
      return {
        role: node.role,
        title: node.title,
        value: node.value,
        description: node.description,
        enabled: node.enabled,
        focused: node.focused,
        actions: node.actions,
        bounds: node.bounds,
      };
    },
    invoke: () => {},
    toggle: () => {},
    expand: () => {},
    collapse: () => {},
    setValue: () => {},
    focus: () => {},
    retain: () => {},
    release: () => {},
  };
}

describe('createWinUiaBridge', () => {
  const tree: FakeEl = {
    id: 'win',
    role: 'AXWindow',
    title: 'Notepad',
    kids: [
      { id: 'btn', role: 'AXButton', title: 'Save', actions: ['press'] },
      {
        id: 'edit',
        role: 'AXTextField',
        value: 'hello',
        actions: [],
        bounds: { x: 10, y: 20, width: 100, height: 24 },
      },
    ],
  };

  it('snapshot 从 hwnd 走树并登记句柄', async () => {
    const ax = createWinUiaBridge(fakeRaw(tree));
    const nodes = await ax.snapshot(42, 2);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe('AXWindow');
    expect(nodes[0].title).toBe('Notepad');
    expect(nodes[0].children?.map((child) => child.title)).toEqual(['Save', undefined]);
    expect(nodes[0].children?.[1].value).toBe('hello');
    expect(nodes[0].ref).toMatch(/^ax-/);
  });

  it('未知 hwnd 得到空树', async () => {
    const ax = createWinUiaBridge(fakeRaw(tree));
    expect(await ax.snapshot(7, 2)).toEqual([]);
  });

  it('query 按 title 过滤', async () => {
    const ax = createWinUiaBridge(fakeRaw(tree));
    const found = await ax.query(42, { title: 'save', limit: 8 });
    expect(found.map((node) => node.title)).toEqual(['Save']);
  });

  it('elementAt / focused 能描述节点', async () => {
    const at: FakeEl = { id: 'pt', role: 'AXButton', title: 'OK' };
    const ax = createWinUiaBridge(fakeRaw(tree, { at, focused: at }));
    expect((await ax.elementAt(1, 2))?.title).toBe('OK');
    expect((await ax.focused())?.title).toBe('OK');
  });

  it('dispatchAxJob 把 Windows snapshot 的 pid 当 hwnd', async () => {
    const ax = createWinUiaBridge(fakeRaw(tree));
    const nodes = (await dispatchAxJob(ax, { op: 'snapshot', pid: 42, maxDepth: 1 })) as Array<{
      role: string;
    }>;
    expect(nodes[0].role).toBe('AXWindow');
  });
});

// Chromium/Electron 在第一个 UIA 客户端连上时才开始建无障碍树：第一次只看得到外壳
function lazyRaw(root: FakeEl) {
  const raw = fakeRaw(root);
  const seen = new Set<unknown>();
  const calls = { children: 0 };
  const children = raw.children;
  raw.children = (el) => {
    calls.children += 1;
    if (!seen.has(el)) {
      seen.add(el);
      return [];
    }
    return children(el);
  };
  return { raw, calls };
}

describe('createWinUiaBridge 首次访问懒建树的窗口', () => {
  const tree: FakeEl = {
    id: 'win',
    role: 'AXWindow',
    title: 'App',
    kids: [{ id: 'btn', role: 'AXButton', title: 'Save', actions: ['press'] }],
  };

  it('第一次 snapshot 就返回完整子树', async () => {
    const { raw } = lazyRaw(tree);
    const nodes = await createWinUiaBridge(raw).snapshot(42, 2);
    expect(nodes[0].children?.map((child) => child.title)).toEqual(['Save']);
  });

  it('同一窗口之后的 snapshot 只走一遍树', async () => {
    const { raw, calls } = lazyRaw(tree);
    const ax = createWinUiaBridge(raw);
    await ax.snapshot(42, 2);
    const before = calls.children;
    await ax.snapshot(42, 2);
    expect(calls.children - before).toBe(2);
  });

  it('第一次 query 也能找到懒建出来的控件', async () => {
    const { raw } = lazyRaw(tree);
    const found = await createWinUiaBridge(raw).query(42, { title: 'save', limit: 8 });
    expect(found.map((node) => node.title)).toEqual(['Save']);
  });
});
