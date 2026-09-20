import type { AxTreeNode } from '@shared/computer/axTree';
import { isLikelyCfPointer, takeOwnedRefs } from './axCfArray';
import { type AxJobBridge, dispatchAxJob } from './axJob';
import { collectAxRoots } from './axRoots';
import {
  AX_MESSAGING_TIMEOUT_SEC,
  AX_SNAPSHOT_MAX_CHILDREN,
  axNextDepth,
  axRowTitleFromCells,
  axShouldExpand,
  axWalkDecision,
} from './axWalkBudget';
import type { AxWorkerRequest } from './axWorkerClient';

interface KoffiApi {
  load(path: string): {
    func: (name: string, ret: string, args: unknown[]) => (...args: unknown[]) => unknown;
  };
  pointer(ref: unknown, count?: number): unknown;
  out(type: unknown): unknown;
}

let cached: Promise<AxJobBridge | null> | undefined;

async function loadAxBridge(): Promise<AxJobBridge | null> {
  cached ??= load().catch(() => null);
  return cached;
}

async function load(): Promise<AxJobBridge> {
  const koffi = (await import('koffi')).default as unknown as KoffiApi;
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const ax = koffi.load(
    '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
  );
  const CFRelease = cf.func('CFRelease', 'void', ['void *']);
  const CFRetain = cf.func('CFRetain', 'void *', ['void *']);
  const CFArrayGetCount = cf.func('CFArrayGetCount', 'long', ['void *']);
  const CFArrayGetValueAtIndex = cf.func('CFArrayGetValueAtIndex', 'void *', ['void *', 'long']);
  const CFStringCreateWithCString = cf.func('CFStringCreateWithCString', 'void *', [
    'void *',
    'str',
    'uint32',
  ]);
  const CFStringGetLength = cf.func('CFStringGetLength', 'long', ['void *']);
  const CFStringGetCString = cf.func('CFStringGetCString', 'bool', [
    'void *',
    'char *',
    'long',
    'uint32',
  ]);
  const CFGetTypeID = cf.func('CFGetTypeID', 'ulong', ['void *']);
  const CFStringGetTypeID = cf.func('CFStringGetTypeID', 'ulong', []);
  const AXUIElementCreateApplication = ax.func('AXUIElementCreateApplication', 'void *', ['int']);
  const AXIsProcessTrusted = ax.func('AXIsProcessTrusted', 'bool', []);
  const axRefOut = koffi.out(koffi.pointer('void', 2));
  const AXUIElementCopyAttributeValue = ax.func('AXUIElementCopyAttributeValue', 'int', [
    'void *',
    'void *',
    axRefOut,
  ]);
  const AXUIElementCopyElementAtPosition = ax.func('AXUIElementCopyElementAtPosition', 'int', [
    'void *',
    'float',
    'float',
    axRefOut,
  ]);
  const AXUIElementSetMessagingTimeout = ax.func('AXUIElementSetMessagingTimeout', 'int', [
    'void *',
    'float',
  ]);
  const AXUIElementPerformAction = ax.func('AXUIElementPerformAction', 'int', ['void *', 'void *']);
  const AXUIElementSetAttributeValue = ax.func('AXUIElementSetAttributeValue', 'int', [
    'void *',
    'void *',
    'void *',
  ]);
  const AXValueGetValue = ax.func('AXValueGetValue', 'bool', ['void *', 'uint32', 'void *']);
  const kCFStringEncodingUTF8 = 0x08000100;
  const cfString = (value: string) => CFStringCreateWithCString(null, value, kCFStringEncodingUTF8);
  const readString = (ref: unknown): string => {
    if (!ref) return '';
    if (CFGetTypeID(ref) !== CFStringGetTypeID()) return '';
    const length = Number(CFStringGetLength(ref)) + 1;
    const buf = Buffer.alloc(length * 4);
    if (!CFStringGetCString(ref, buf, buf.length, kCFStringEncodingUTF8)) return '';
    const end = buf.indexOf(0);
    return buf.toString('utf8', 0, end === -1 ? buf.length : end);
  };

  const handles = new Map<string, unknown>();
  let nextHandle = 1;
  const retain = (element: unknown): string => {
    const id = `ax${nextHandle++}`;
    handles.set(id, element);
    return id;
  };
  const requireHandle = (handle: string): unknown => {
    const element = handles.get(handle);
    if (!element) throw new Error(`${handle} expired; re-run ax()/find()`);
    return element;
  };
  const axActionName = (action: string) =>
    action.startsWith('AX') ? action : `AX${action[0].toUpperCase()}${action.slice(1)}`;
  const readAxString = (element: unknown, name: string): string => {
    if (!isLikelyCfPointer(element)) return '';
    const attr = cfString(name);
    const out = [null];
    try {
      if (AXUIElementCopyAttributeValue(element, attr, out) !== 0) return '';
      const value = out[0];
      const text = readString(value);
      if (value) CFRelease(value);
      return text;
    } finally {
      CFRelease(attr);
    }
  };
  const readAxChildren = (element: unknown): unknown[] => {
    if (!isLikelyCfPointer(element)) return [];
    const attr = cfString('AXChildren');
    const out = [null];
    try {
      if (AXUIElementCopyAttributeValue(element, attr, out) !== 0 || !out[0]) return [];
      const array = out[0];
      const children = takeOwnedRefs(
        Number(CFArrayGetCount(array)),
        (i) => CFArrayGetValueAtIndex(array, i),
        (item) => {
          CFRetain(item);
        }
      );
      CFRelease(array);
      return children;
    } finally {
      CFRelease(attr);
    }
  };
  const readAxCgPair = (
    element: unknown,
    name: string,
    type: number
  ): { a: number; b: number } | undefined => {
    if (!isLikelyCfPointer(element)) return undefined;
    const attr = cfString(name);
    const out = [null];
    try {
      if (AXUIElementCopyAttributeValue(element, attr, out) !== 0 || !out[0]) return undefined;
      const buf = Buffer.alloc(16);
      const ok = Boolean(AXValueGetValue(out[0], type, buf));
      CFRelease(out[0]);
      if (!ok) return undefined;
      return { a: buf.readDoubleLE(0), b: buf.readDoubleLE(8) };
    } finally {
      CFRelease(attr);
    }
  };
  const readAxBounds = (element: unknown) => {
    const pos = readAxCgPair(element, 'AXPosition', 1);
    const size = readAxCgPair(element, 'AXSize', 2);
    if (!pos || !size) return undefined;
    return { x: pos.a, y: pos.b, width: size.a, height: size.b };
  };
  const describe = (element: unknown, handle?: string): AxTreeNode => ({
    ref: handle ?? retain(element),
    role: readAxString(element, 'AXRole') || 'unknown',
    title: readAxString(element, 'AXTitle') || undefined,
    value: readAxString(element, 'AXValue') || undefined,
    description: readAxString(element, 'AXDescription') || undefined,
    bounds: readAxBounds(element),
  });
  const readCellTexts = (element: unknown): string[] => {
    const texts: string[] = [];
    for (const child of readAxChildren(element).slice(0, 8)) {
      const title = readAxString(child, 'AXTitle');
      const value = readAxString(child, 'AXValue');
      if (title) texts.push(title);
      else if (value) texts.push(value);
      else {
        const nested = readAxChildren(child)[0];
        if (nested) {
          const nestedText = readAxString(nested, 'AXTitle') || readAxString(nested, 'AXValue');
          if (nestedText) texts.push(nestedText);
        }
      }
    }
    return texts;
  };
  const fillRowTitle = (node: AxTreeNode, element: unknown) => {
    if (node.role !== 'AXRow' && node.role !== 'AXCell') return;
    const title = axRowTitleFromCells(node.title, node.value, readCellTexts(element));
    if (title) node.title = title;
  };
  const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const walk = async (
    element: unknown,
    depth: number,
    maxDepth: number,
    startedAt: number,
    counter: { nodes: number }
  ): Promise<AxTreeNode> => {
    if (axWalkDecision({ startedAt, nodeCount: counter.nodes }) === 'timeout') {
      throw new Error('AX_TIMEOUT');
    }
    counter.nodes += 1;
    const node = describe(element);
    if (
      !axShouldExpand(node.role, depth, maxDepth) ||
      axWalkDecision({ startedAt, nodeCount: counter.nodes }) !== 'continue'
    ) {
      fillRowTitle(node, element);
      return node;
    }
    if (counter.nodes % 4 === 0) await yieldTurn();
    if (axWalkDecision({ startedAt, nodeCount: counter.nodes }) === 'timeout') {
      throw new Error('AX_TIMEOUT');
    }
    const children: AxTreeNode[] = [];
    for (const child of readAxChildren(element).slice(0, AX_SNAPSHOT_MAX_CHILDREN)) {
      const next = axWalkDecision({ startedAt, nodeCount: counter.nodes });
      if (next === 'timeout') throw new Error('AX_TIMEOUT');
      if (next === 'budget') break;
      children.push(await walk(child, axNextDepth(node.role, depth), maxDepth, startedAt, counter));
    }
    node.children = children;
    return node;
  };

  return {
    async snapshot(pid, maxDepth) {
      const app = AXUIElementCreateApplication(pid);
      if (!app) throw new Error('AXUIElementCreateApplication failed');
      AXUIElementSetMessagingTimeout(app, AX_MESSAGING_TIMEOUT_SEC);
      const trusted = Boolean(AXIsProcessTrusted());
      const toRelease: unknown[] = [];
      const copyArray = (name: string): { status: number; values: unknown[] } => {
        const attr = cfString(name);
        const out = [null];
        const status = Number(AXUIElementCopyAttributeValue(app, attr, out));
        CFRelease(attr);
        const array = out[0];
        if (!isLikelyCfPointer(array)) return { status, values: [] };
        const values = takeOwnedRefs(
          Number(CFArrayGetCount(array)),
          (i) => CFArrayGetValueAtIndex(array, i),
          (item) => {
            CFRetain(item);
            toRelease.push(item);
          }
        );
        CFRelease(array);
        return { status, values };
      };
      const copyOne = (name: string): { status: number; values: unknown[] } => {
        const attr = cfString(name);
        const out = [null];
        const status = Number(AXUIElementCopyAttributeValue(app, attr, out));
        CFRelease(attr);
        if (!isLikelyCfPointer(out[0])) return { status, values: [] };
        toRelease.push(out[0]);
        return { status, values: [out[0]] };
      };
      const windows = copyArray('AXWindows');
      const status = windows.status;
      try {
        if (!trusted || status === -25211) throw new Error('AX_TCC_DENIED');
        if (status === -25204) throw new Error('AX_TIMEOUT');
        let roots = collectAxRoots((attr) => {
          if (attr === 'AXWindows') return windows.values;
          if (attr === 'AXChildren') return copyArray(attr).values;
          return copyOne(attr).values;
        }).filter((element) => readAxString(element, 'AXRole') !== 'AXMenuBar');
        if (roots.length === 0) roots = windows.values;
        if (roots.length === 0 && status !== 0) throw new Error(`AX_STATUS_${status}`);
        const startedAt = Date.now();
        const counter = { nodes: 0 };
        const nodes: AxTreeNode[] = [];
        for (const element of roots.slice(0, 8)) {
          const next = axWalkDecision({ startedAt, nodeCount: counter.nodes });
          if (next === 'timeout') throw new Error('AX_TIMEOUT');
          if (next === 'budget') break;
          nodes.push(await walk(element, 0, maxDepth, startedAt, counter));
        }
        return nodes;
      } finally {
        for (const ref of toRelease) CFRelease(ref);
        CFRelease(app);
      }
    },
    async elementAt(x, y) {
      const sys = AXUIElementCreateApplication(0);
      AXUIElementSetMessagingTimeout(sys, AX_MESSAGING_TIMEOUT_SEC);
      const out = [null];
      if (AXUIElementCopyElementAtPosition(sys, x, y, out) !== 0 || !out[0]) {
        CFRelease(sys);
        return null;
      }
      const node = describe(out[0]);
      CFRelease(sys);
      return node;
    },
    async focused() {
      const sys = AXUIElementCreateApplication(0);
      AXUIElementSetMessagingTimeout(sys, AX_MESSAGING_TIMEOUT_SEC);
      const attr = cfString('AXFocusedUIElement');
      const out = [null];
      const status = Number(AXUIElementCopyAttributeValue(sys, attr, out));
      CFRelease(attr);
      CFRelease(sys);
      if (status !== 0 || !out[0]) return null;
      return describe(out[0]);
    },
    async node(handle) {
      return describe(requireHandle(handle), handle);
    },
    async attributes(handle) {
      const node = describe(requireHandle(handle), handle);
      return [
        ['role', node.role],
        ...(node.title ? [['title', node.title] as [string, string]] : []),
      ];
    },
    async children(handle) {
      return readAxChildren(requireHandle(handle)).map((child) => describe(child));
    },
    async perform(handle, action) {
      const attr = cfString(axActionName(action));
      const status = AXUIElementPerformAction(requireHandle(handle), attr);
      CFRelease(attr);
      if (status !== 0) throw new Error(`AX action ${action} failed (${status})`);
    },
    async setValue(handle, value) {
      const attr = cfString('AXValue');
      const cfValue = cfString(value);
      AXUIElementSetAttributeValue(requireHandle(handle), attr, cfValue);
      CFRelease(attr);
      CFRelease(cfValue);
    },
    async focus(handle) {
      const attr = cfString('AXRaise');
      AXUIElementPerformAction(requireHandle(handle), attr);
      CFRelease(attr);
    },
  };
}

export async function performAxJob(request: AxWorkerRequest): Promise<unknown> {
  const ax = await loadAxBridge();
  if (!ax) throw new Error('AX native unavailable');
  return dispatchAxJob(ax, request);
}
