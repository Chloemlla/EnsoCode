import { randomBytes } from 'node:crypto';
import type { AxTreeNode } from '@shared/computer/axTree';
import { type AxJobBridge, dispatchAxJob } from './axJob';
import { AxHandleTable } from './axNative';
import {
  AX_SNAPSHOT_MAX_CHILDREN,
  axFillEmptyRowTitle,
  axKeepPartialOnTimeout,
  axNextDepth,
  axNodeMatchesQuery,
  axQueryShouldExpand,
  axShouldExpand,
  axWalkDecision,
} from './axWalkBudget';
import type { AxWorkerRequest } from './axWorkerClient';
import { uiaNormalizeAction } from './winUiaMap';

export type WinUiaRaw = {
  elementFromHandle(hwnd: number): unknown | null;
  elementFromPoint(x: number, y: number): unknown | null;
  focused(): unknown | null;
  children(el: unknown): unknown[];
  describe(el: unknown): Omit<AxTreeNode, 'ref' | 'children'>;
  invoke(el: unknown): void;
  toggle(el: unknown): void;
  expand(el: unknown): void;
  collapse(el: unknown): void;
  setValue(el: unknown, value: string): void;
  focus(el: unknown): void;
  retain(el: unknown): void;
  release(el: unknown): void;
};

const AX_DESKTOP_SCOPE = 'desktop';
const PRESS_UNSUPPORTED = 'AX action press failed (-25206)';

export function createWinUiaBridge(raw: WinUiaRaw): AxJobBridge {
  const handles = new AxHandleTable<unknown>(randomBytes(4).toString('hex'), {
    retain: (el) => raw.retain(el),
    release: (el) => raw.release(el),
  });

  const describe = (el: unknown, ref: string): AxTreeNode => ({ ...raw.describe(el), ref });
  const describeNew = (el: unknown, at: { scope: string; generation: number }) =>
    describe(el, handles.add(el, at));

  const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const walk = async (
    el: unknown,
    depth: number,
    maxDepth: number,
    startedAt: number,
    counter: { nodes: number },
    at: { scope: string; generation: number }
  ): Promise<AxTreeNode> => {
    if (axWalkDecision({ startedAt, nodeCount: counter.nodes }) === 'timeout') {
      if (!axKeepPartialOnTimeout(counter.nodes)) throw new Error('AX_TIMEOUT');
    }
    counter.nodes += 1;
    const node = describeNew(el, at);
    if (
      !axShouldExpand(node.role, depth, maxDepth) ||
      axWalkDecision({ startedAt, nodeCount: counter.nodes }) !== 'continue'
    ) {
      axFillEmptyRowTitle(node);
      return node;
    }
    if (counter.nodes % 4 === 0) await yieldTurn();
    if (axWalkDecision({ startedAt, nodeCount: counter.nodes }) === 'timeout') {
      axFillEmptyRowTitle(node);
      return node;
    }
    const children: AxTreeNode[] = [];
    const kids = raw.children(el);
    try {
      for (const child of kids.slice(0, AX_SNAPSHOT_MAX_CHILDREN)) {
        if (axWalkDecision({ startedAt, nodeCount: counter.nodes }) !== 'continue') break;
        children.push(
          await walk(child, axNextDepth(node.role, depth), maxDepth, startedAt, counter, at)
        );
      }
    } finally {
      for (const child of kids) raw.release(child);
    }
    node.children = children;
    axFillEmptyRowTitle(node);
    return node;
  };

  const withRoot = async (
    hwnd: number,
    fn: (root: unknown, at: { scope: string; generation: number }) => Promise<AxTreeNode[]>
  ): Promise<AxTreeNode[]> => {
    const root = raw.elementFromHandle(hwnd);
    if (!root) return [];
    const at = handles.begin(`hwnd:${hwnd}`);
    try {
      return await fn(root, at);
    } finally {
      raw.release(root);
    }
  };

  return {
    async snapshot(hwnd, maxDepth) {
      return withRoot(hwnd, async (root, at) => {
        const startedAt = Date.now();
        return [await walk(root, 0, maxDepth, startedAt, { nodes: 0 }, at)];
      });
    },
    async query(hwnd, query) {
      return withRoot(hwnd, async (root, at) => {
        const found: AxTreeNode[] = [];
        const limit = query.limit ?? 20;
        const startedAt = Date.now();
        const counter = { nodes: 0 };
        const queue: unknown[] = [root];
        raw.retain(root);
        const owned = [root];
        try {
          while (queue.length > 0 && found.length < limit) {
            if (axWalkDecision({ startedAt, nodeCount: counter.nodes }) !== 'continue') break;
            const el = queue.shift();
            if (!el) break;
            counter.nodes += 1;
            const lite = raw.describe(el);
            if (axNodeMatchesQuery(lite, query)) found.push(describeNew(el, at));
            if (found.length >= limit) break;
            if (!axQueryShouldExpand(lite.role ?? 'AXUnknown')) continue;
            const kids = raw.children(el);
            owned.push(...kids);
            queue.push(...kids.slice(0, AX_SNAPSHOT_MAX_CHILDREN));
          }
          return found;
        } finally {
          for (const el of owned) raw.release(el);
        }
      });
    },
    async elementAt(x, y) {
      const el = raw.elementFromPoint(x, y);
      if (!el) return null;
      try {
        return describeNew(el, handles.begin(AX_DESKTOP_SCOPE));
      } finally {
        raw.release(el);
      }
    },
    async focused() {
      const el = raw.focused();
      if (!el) return null;
      try {
        return describeNew(el, handles.begin(AX_DESKTOP_SCOPE));
      } finally {
        raw.release(el);
      }
    },
    async node(handle) {
      return describe(handles.get(handle), handle);
    },
    async attributes(handle) {
      const node = describe(handles.get(handle), handle);
      return [
        ['role', node.role],
        ...(node.title ? ([['title', node.title]] as Array<[string, string]>) : []),
      ];
    },
    async children(handle) {
      const el = handles.get(handle);
      const at = handles.scopeOf(handle);
      const kids = raw.children(el);
      try {
        return kids.map((child) => describeNew(child, at));
      } finally {
        for (const child of kids) raw.release(child);
      }
    },
    async perform(handle, action) {
      const el = handles.get(handle);
      const kind = uiaNormalizeAction(action);
      if (kind === 'expand') {
        raw.expand(el);
        return;
      }
      if (kind === 'collapse') {
        raw.collapse(el);
        return;
      }
      if (kind !== 'press') throw new Error(`AX action ${action} failed (-25206)`);
      try {
        raw.invoke(el);
        return;
      } catch {
        // Toggle 也当成 press
      }
      try {
        raw.toggle(el);
      } catch {
        throw new Error(PRESS_UNSUPPORTED);
      }
    },
    async setValue(handle, value) {
      raw.setValue(handles.get(handle), value);
    },
    async focus(handle) {
      raw.focus(handles.get(handle));
    },
  };
}

let cached: Promise<AxJobBridge | null> | undefined;

async function loadBridge(): Promise<AxJobBridge | null> {
  cached ??= (async () => {
    const { loadWinUiaRaw } = await import('./winUiaNative');
    const raw = await loadWinUiaRaw();
    return raw ? createWinUiaBridge(raw) : null;
  })().catch(() => null);
  return cached;
}

export async function performWinUiaJob(request: AxWorkerRequest): Promise<unknown> {
  const ax = await loadBridge();
  if (!ax) throw new Error('UIA native unavailable');
  return dispatchAxJob(ax, request);
}
