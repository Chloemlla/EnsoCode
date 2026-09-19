import { execFile } from 'node:child_process';
import type { AxTreeNode } from '@shared/computer/axTree';
import type { ComputerWindowInfo } from '@shared/computer/types';
import type { PointerOptions } from './backend';
import { decodeCfNumberAsFloat64, kCFNumberFloat64Type } from './cfNumber';

export interface MacosNative {
  windows(): Promise<ComputerWindowInfo[]>;
  click(x: number, y: number, opts?: PointerOptions): Promise<void>;
  move(x: number, y: number): Promise<void>;
  drag(points: Array<{ x: number; y: number }>): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  typeText(text: string): Promise<void>;
  keyChord(keys: string[]): Promise<void>;
  raise(windowId: string): Promise<void>;
  axSnapshot(target: string, maxDepth: number): Promise<AxTreeNode[]>;
  axElementAt(x: number, y: number): Promise<AxTreeNode | null>;
  axFocused(): Promise<AxTreeNode | null>;
  axNode(handle: string): Promise<AxTreeNode>;
  axAttributes(handle: string): Promise<Array<[string, string]>>;
  axChildren(handle: string): Promise<AxTreeNode[]>;
  axParent(handle: string): Promise<AxTreeNode | null>;
  axPerform(handle: string, action: string): Promise<void>;
  axSetValue(handle: string, value: string): Promise<void>;
  axFocus(handle: string): Promise<void>;
}

let cached: Promise<MacosNative | null> | undefined;

export function loadMacosNative(): Promise<MacosNative | null> {
  cached ??= load().catch(() => null);
  return cached;
}

interface KoffiApi {
  load(path: string): {
    func: (name: string, ret: string, args: unknown[]) => (...args: unknown[]) => unknown;
  };
  struct(name: string, fields: Record<string, string>): unknown;
}

async function load(): Promise<MacosNative | null> {
  const koffi = (await import('koffi')).default as unknown as KoffiApi;
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const ax = koffi.load(
    '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
  );

  const CGPoint = koffi.struct('CGPoint', { x: 'double', y: 'double' });
  const CGEventCreateMouseEvent = cg.func('CGEventCreateMouseEvent', 'void *', [
    'void *',
    'uint32',
    CGPoint,
    'uint32',
  ]);
  const CGEventPost = cg.func('CGEventPost', 'void', ['uint32', 'void *']);
  const CFRelease = cf.func('CFRelease', 'void', ['void *']);
  const CGEventCreateKeyboardEvent = cg.func('CGEventCreateKeyboardEvent', 'void *', [
    'void *',
    'uint16',
    'bool',
  ]);
  const CGEventKeyboardSetUnicodeString = cg.func('CGEventKeyboardSetUnicodeString', 'void', [
    'void *',
    'ulong',
    'void *',
  ]);
  const CGEventCreateScrollWheelEvent = cg.func('CGEventCreateScrollWheelEvent', 'void *', [
    'void *',
    'uint32',
    'uint32',
    'int32',
    'int32',
  ]);
  const CGWindowListCopyWindowInfo = cg.func('CGWindowListCopyWindowInfo', 'void *', [
    'uint32',
    'uint32',
  ]);
  const CFArrayGetCount = cf.func('CFArrayGetCount', 'long', ['void *']);
  const CFArrayGetValueAtIndex = cf.func('CFArrayGetValueAtIndex', 'void *', ['void *', 'long']);
  const CFDictionaryGetValue = cf.func('CFDictionaryGetValue', 'void *', ['void *', 'void *']);
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
  const CFNumberGetValue = cf.func('CFNumberGetValue', 'bool', ['void *', 'int', 'void *']);
  const CFGetTypeID = cf.func('CFGetTypeID', 'ulong', ['void *']);
  const CFStringGetTypeID = cf.func('CFStringGetTypeID', 'ulong', []);
  const CFNumberGetTypeID = cf.func('CFNumberGetTypeID', 'ulong', []);
  const CFDictionaryGetTypeID = cf.func('CFDictionaryGetTypeID', 'ulong', []);
  const AXUIElementCreateApplication = ax.func('AXUIElementCreateApplication', 'void *', ['int']);
  const AXUIElementCopyAttributeValue = ax.func('AXUIElementCopyAttributeValue', 'int', [
    'void *',
    'void *',
    'void **',
  ]);
  const AXUIElementPerformAction = ax.func('AXUIElementPerformAction', 'int', ['void *', 'void *']);
  const AXUIElementSetAttributeValue = ax.func('AXUIElementSetAttributeValue', 'int', [
    'void *',
    'void *',
    'void *',
  ]);
  const AXUIElementCopyElementAtPosition = ax.func('AXUIElementCopyElementAtPosition', 'int', [
    'void *',
    'float',
    'float',
    'void **',
  ]);
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
  const readNumber = (ref: unknown): number => {
    if (!ref) return 0;
    if (CFGetTypeID(ref) !== CFNumberGetTypeID()) return 0;
    const out = Buffer.alloc(8);
    if (!CFNumberGetValue(ref, kCFNumberFloat64Type, out)) return 0;
    return decodeCfNumberAsFloat64(out);
  };
  const dictGet = (dict: unknown, key: string): unknown => {
    const cfKey = cfString(key);
    try {
      return CFDictionaryGetValue(dict, cfKey);
    } finally {
      CFRelease(cfKey);
    }
  };

  const kCGWindowListOptionOnScreenOnly = 1;
  const kCGWindowListExcludeDesktopElements = 16;
  const kCGHIDEventTap = 0;
  const kCGEventMouseMoved = 5;
  const kCGEventLeftMouseDown = 1;
  const kCGEventLeftMouseUp = 2;
  const kCGMouseButtonLeft = 0;
  const kCGEventLeftMouseDragged = 6;

  const postMouse = (type: number, x: number, y: number) => {
    const event = CGEventCreateMouseEvent(null, type, { x, y }, kCGMouseButtonLeft);
    if (!event) throw new Error('CGEventCreateMouseEvent failed');
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
  };

  const handles = new Map<string, unknown>();
  let nextHandle = 1;
  const retain = (element: unknown): string => {
    const id = `ax${nextHandle++}`;
    handles.set(id, element);
    return id;
  };

  const readAxString = (element: unknown, name: string): string => {
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
    const attr = cfString('AXChildren');
    const out = [null];
    try {
      if (AXUIElementCopyAttributeValue(element, attr, out) !== 0 || !out[0]) return [];
      const array = out[0];
      const count = Number(CFArrayGetCount(array));
      const children: unknown[] = [];
      for (let i = 0; i < count; i++) children.push(CFArrayGetValueAtIndex(array, i));
      CFRelease(array);
      return children;
    } finally {
      CFRelease(attr);
    }
  };

  const describe = (element: unknown): AxTreeNode => {
    const handle = retain(element);
    return {
      ref: handle,
      role: readAxString(element, 'AXRole') || 'unknown',
      title: readAxString(element, 'AXTitle') || undefined,
      value: readAxString(element, 'AXValue') || undefined,
      description: readAxString(element, 'AXDescription') || undefined,
    };
  };

  const walk = (element: unknown, depth: number, maxDepth: number): AxTreeNode => {
    const node = describe(element);
    if (depth >= maxDepth) return node;
    node.children = readAxChildren(element)
      .slice(0, 80)
      .map((child) => walk(child, depth + 1, maxDepth));
    return node;
  };

  const windowPid = async (target: string): Promise<{ pid: number; windowId: number }> => {
    const windows = await listWindows();
    const found = windows.find((window) => window.id === target);
    if (!found) throw new Error(`window '${target}' not found`);
    return { pid: found.pid, windowId: Number(found.id) };
  };

  const listWindows = async (): Promise<ComputerWindowInfo[]> => {
    const array = CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
      0
    );
    if (!array) return [];
    try {
      const count = Number(CFArrayGetCount(array));
      const windows: ComputerWindowInfo[] = [];
      for (let i = 0; i < count; i++) {
        const dict = CFArrayGetValueAtIndex(array, i);
        if (!dict || CFGetTypeID(dict) !== CFDictionaryGetTypeID()) continue;
        const bounds = dictGet(dict, 'kCGWindowBounds');
        const layer = readNumber(dictGet(dict, 'kCGWindowLayer'));
        if (layer !== 0) continue;
        const id = String(Math.round(readNumber(dictGet(dict, 'kCGWindowNumber'))));
        windows.push({
          id,
          app: readString(dictGet(dict, 'kCGWindowOwnerName')),
          title: readString(dictGet(dict, 'kCGWindowName')),
          pid: Math.round(readNumber(dictGet(dict, 'kCGWindowOwnerPID'))),
          focused: windows.length === 0,
          x:
            bounds && CFGetTypeID(bounds) === CFDictionaryGetTypeID()
              ? readNumber(dictGet(bounds, 'X'))
              : 0,
          y:
            bounds && CFGetTypeID(bounds) === CFDictionaryGetTypeID()
              ? readNumber(dictGet(bounds, 'Y'))
              : 0,
          width:
            bounds && CFGetTypeID(bounds) === CFDictionaryGetTypeID()
              ? readNumber(dictGet(bounds, 'Width'))
              : 0,
          height:
            bounds && CFGetTypeID(bounds) === CFDictionaryGetTypeID()
              ? readNumber(dictGet(bounds, 'Height'))
              : 0,
        });
      }
      return windows;
    } finally {
      CFRelease(array);
    }
  };

  const keyCode = (key: string): number => {
    const map: Record<string, number> = {
      a: 0,
      s: 1,
      d: 2,
      f: 3,
      h: 4,
      g: 5,
      z: 6,
      x: 7,
      c: 8,
      v: 9,
      b: 11,
      q: 12,
      w: 13,
      e: 14,
      r: 15,
      y: 16,
      t: 17,
      '1': 18,
      '2': 19,
      '3': 20,
      '4': 21,
      '6': 22,
      '5': 23,
      equal: 24,
      '9': 25,
      '7': 26,
      minus: 27,
      '8': 28,
      '0': 29,
      o: 31,
      u: 32,
      i: 34,
      p: 35,
      enter: 36,
      return: 36,
      l: 37,
      j: 38,
      k: 40,
      ';': 41,
      n: 45,
      m: 46,
      tab: 48,
      space: 49,
      escape: 53,
      esc: 53,
      cmd: 55,
      command: 55,
      shift: 56,
      option: 58,
      alt: 58,
      control: 59,
      ctrl: 59,
      delete: 51,
      backspace: 51,
    };
    return map[key.toLowerCase()] ?? 0;
  };

  const postKey = (code: number, down: boolean) => {
    const event = CGEventCreateKeyboardEvent(null, code, down);
    if (!event) throw new Error('CGEventCreateKeyboardEvent failed');
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
  };

  return {
    windows: listWindows,
    async click(x, y) {
      postMouse(kCGEventMouseMoved, x, y);
      postMouse(kCGEventLeftMouseDown, x, y);
      postMouse(kCGEventLeftMouseUp, x, y);
    },
    async move(x, y) {
      postMouse(kCGEventMouseMoved, x, y);
    },
    async drag(points) {
      if (points.length === 0) return;
      postMouse(kCGEventMouseMoved, points[0].x, points[0].y);
      postMouse(kCGEventLeftMouseDown, points[0].x, points[0].y);
      for (const point of points.slice(1)) postMouse(kCGEventLeftMouseDragged, point.x, point.y);
      const last = points[points.length - 1];
      postMouse(kCGEventLeftMouseUp, last.x, last.y);
    },
    async scroll(x, y, dx, dy) {
      postMouse(kCGEventMouseMoved, x, y);
      const event = CGEventCreateScrollWheelEvent(null, 0, 2, Math.round(dy), Math.round(dx));
      if (!event) throw new Error('CGEventCreateScrollWheelEvent failed');
      CGEventPost(kCGHIDEventTap, event);
      CFRelease(event);
    },
    async typeText(text) {
      for (const char of text) {
        const buf = Buffer.from(char, 'utf16le');
        const units = buf.length / 2;
        if (units === 0) continue;
        const down = CGEventCreateKeyboardEvent(null, 0, true);
        if (!down) throw new Error('CGEventCreateKeyboardEvent failed');
        CGEventKeyboardSetUnicodeString(down, units, buf);
        CGEventPost(kCGHIDEventTap, down);
        CFRelease(down);
        const up = CGEventCreateKeyboardEvent(null, 0, false);
        if (!up) throw new Error('CGEventCreateKeyboardEvent failed');
        CGEventKeyboardSetUnicodeString(up, units, buf);
        CGEventPost(kCGHIDEventTap, up);
        CFRelease(up);
      }
    },
    async keyChord(keys) {
      const codes = keys.map(keyCode);
      for (const code of codes) postKey(code, true);
      for (const code of [...codes].reverse()) postKey(code, false);
    },
    async raise(windowId) {
      const { pid } = await windowPid(windowId);
      const app = AXUIElementCreateApplication(pid);
      if (!app) throw new Error('AXUIElementCreateApplication failed');
      const raiseAttr = cfString('AXRaise');
      const windowsAttr = cfString('AXWindows');
      const out = [null];
      AXUIElementCopyAttributeValue(app, windowsAttr, out);
      const array = out[0];
      if (array) {
        if (Number(CFArrayGetCount(array)) > 0) {
          AXUIElementPerformAction(CFArrayGetValueAtIndex(array, 0), raiseAttr);
        }
        CFRelease(array);
      }
      AXUIElementPerformAction(app, raiseAttr);
      CFRelease(raiseAttr);
      CFRelease(windowsAttr);
      CFRelease(app);
      if (Number.isInteger(pid) && pid > 0) {
        await new Promise<void>((resolve) => {
          execFile(
            '/usr/bin/osascript',
            [
              '-e',
              `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
            ],
            { timeout: 4000 },
            () => resolve()
          );
        });
      }
    },
    async axSnapshot(target, maxDepth) {
      const { pid } = await windowPid(target);
      const app = AXUIElementCreateApplication(pid);
      if (!app) throw new Error('AXUIElementCreateApplication failed');
      const windowsAttr = cfString('AXWindows');
      const out = [null];
      AXUIElementCopyAttributeValue(app, windowsAttr, out);
      CFRelease(windowsAttr);
      const array = out[0];
      if (!array) {
        CFRelease(app);
        return [];
      }
      const count = Number(CFArrayGetCount(array));
      const nodes: AxTreeNode[] = [];
      for (let i = 0; i < Math.min(count, 8); i++) {
        nodes.push(walk(CFArrayGetValueAtIndex(array, i), 0, maxDepth));
      }
      CFRelease(array);
      CFRelease(app);
      return nodes;
    },
    async axElementAt(x, y) {
      const sys = AXUIElementCreateApplication(0);
      const out = [null];
      if (AXUIElementCopyElementAtPosition(sys, x, y, out) !== 0 || !out[0]) {
        CFRelease(sys);
        return null;
      }
      const node = describe(out[0]);
      CFRelease(sys);
      return node;
    },
    async axFocused() {
      return null;
    },
    async axNode(handle) {
      const element = handles.get(handle);
      if (!element) throw new Error(`${handle} expired; re-run ax()/find()`);
      return describe(element);
    },
    async axAttributes(handle) {
      const element = handles.get(handle);
      if (!element) throw new Error(`${handle} expired; re-run ax()/find()`);
      const node = describe(element);
      return [
        ['role', node.role],
        ...(node.title ? [['title', node.title] as [string, string]] : []),
      ];
    },
    async axChildren(handle) {
      const element = handles.get(handle);
      if (!element) throw new Error(`${handle} expired; re-run ax()/find()`);
      return readAxChildren(element).map(describe);
    },
    async axParent() {
      return null;
    },
    async axPerform(handle, action) {
      const element = handles.get(handle);
      if (!element) throw new Error(`${handle} expired; re-run ax()/find()`);
      const attr = cfString(
        action.startsWith('AX') ? action : `AX${action[0].toUpperCase()}${action.slice(1)}`
      );
      const status = AXUIElementPerformAction(element, attr);
      CFRelease(attr);
      if (status !== 0) throw new Error(`AX action ${action} failed (${status})`);
    },
    async axSetValue(handle, value) {
      const element = handles.get(handle);
      if (!element) throw new Error(`${handle} expired; re-run ax()/find()`);
      const attr = cfString('AXValue');
      const cfValue = cfString(value);
      AXUIElementSetAttributeValue(element, attr, cfValue);
      CFRelease(attr);
      CFRelease(cfValue);
    },
    async axFocus(handle) {
      const element = handles.get(handle);
      if (!element) throw new Error(`${handle} expired; re-run ax()/find()`);
      const attr = cfString('AXRaise');
      AXUIElementPerformAction(element, attr);
      CFRelease(attr);
    },
  };
}
