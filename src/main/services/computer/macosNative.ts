import { execFile } from 'node:child_process';
import type { AxTreeNode } from '@shared/computer/axTree';
import type { ComputerWindowInfo } from '@shared/computer/types';
import { AX_WORKER_TIMEOUT_MS } from './axWalkBudget';
import type { AxWorkerRequest } from './axWorkerClient';
import { createAxWorkerClient, spawnAxWorker } from './axWorkerClient';
import axWorkerPath from './axWorkerThread?modulePath';
import type { PointerOptions } from './backend';
import { decodeCfNumberAsFloat64, kCFNumberFloat64Type } from './cfNumber';
import { macKeyForAsciiChar, splitMacChord, splitTypeSegments } from './macKey';
import { isListedCgWindowLayer } from './windowSource';

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
  axQuery(
    target: string,
    query: { role?: string; title?: string; value?: string; description?: string; limit?: number }
  ): Promise<AxTreeNode[]>;
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
  pointer(ref: unknown, count?: number): unknown;
  out(type: unknown): unknown;
}

async function load(): Promise<MacosNative | null> {
  const koffi = (await import('koffi')).default as unknown as KoffiApi;
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const ax = koffi.load(
    '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
  );
  const carbon = koffi.load('/System/Library/Frameworks/Carbon.framework/Carbon');

  const CGPoint = koffi.struct('CGPoint', { x: 'double', y: 'double' });
  const CGEventCreateMouseEvent = cg.func('CGEventCreateMouseEvent', 'void *', [
    'void *',
    'uint32',
    CGPoint,
    'uint32',
  ]);
  const CGEventPost = cg.func('CGEventPost', 'void', ['uint32', 'void *']);
  const CFRelease = cf.func('CFRelease', 'void', ['void *']);
  const TISCopyCurrentKeyboardInputSource = carbon.func(
    'TISCopyCurrentKeyboardInputSource',
    'void *',
    []
  );
  const TISCopyCurrentASCIICapableKeyboardLayoutInputSource = carbon.func(
    'TISCopyCurrentASCIICapableKeyboardLayoutInputSource',
    'void *',
    []
  );
  const TISSelectInputSource = carbon.func('TISSelectInputSource', 'int32', ['void *']);
  const TISCopyInputSourceForLanguage = carbon.func('TISCopyInputSourceForLanguage', 'void *', [
    'void *',
  ]);
  const CGEventCreateKeyboardEvent = cg.func('CGEventCreateKeyboardEvent', 'void *', [
    'void *',
    'uint16',
    'bool',
  ]);
  const CGEventSetFlags = cg.func('CGEventSetFlags', 'void', ['void *', 'uint64']);
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
  const axRefOut = koffi.out(koffi.pointer('void', 2));
  const AXUIElementCopyAttributeValue = ax.func('AXUIElementCopyAttributeValue', 'int', [
    'void *',
    'void *',
    axRefOut,
  ]);
  const AXUIElementPerformAction = ax.func('AXUIElementPerformAction', 'int', ['void *', 'void *']);
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

  const windowPid = async (target: string): Promise<{ pid: number; windowId: number }> => {
    const windows = await listWindows();
    const found = windows.find((window) => window.id === target);
    if (!found) throw new Error(`window '${target}' not found`);
    if (!found.pid) throw new Error(`window '${target}' has no pid`);
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
        if (!isListedCgWindowLayer(layer)) continue;
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

  const postKey = (code: number, down: boolean, flags = 0) => {
    const event = CGEventCreateKeyboardEvent(null, code, down);
    if (!event) throw new Error('CGEventCreateKeyboardEvent failed');
    CGEventSetFlags(event, flags);
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
  };

  const postUnicodeChar = (char: string) => {
    const buf = Buffer.from(char, 'utf16le');
    const units = buf.length / 2;
    if (units === 0) return;
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
  };

  const withEnglishLayout = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const current = TISCopyCurrentKeyboardInputSource();
    const lang = cfString('en');
    let english = TISCopyInputSourceForLanguage(lang);
    CFRelease(lang);
    if (!english) english = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
    try {
      if (english) {
        TISSelectInputSource(english);
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      const result = await fn();
      if (english) await new Promise<void>((resolve) => setTimeout(resolve, 30));
      return result;
    } finally {
      if (current) TISSelectInputSource(current);
      if (english) CFRelease(english);
      if (current) CFRelease(current);
    }
  };

  let axClient: ReturnType<typeof createAxWorkerClient> | undefined;
  const axCall = async (request: AxWorkerRequest) => {
    if (!axClient) {
      axClient = createAxWorkerClient({
        timeoutMs: AX_WORKER_TIMEOUT_MS,
        spawn: () => spawnAxWorker(axWorkerPath),
      });
    }
    return axClient.call(request);
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
      for (const segment of splitTypeSegments(text)) {
        if (segment.kind === 'ascii') {
          await withEnglishLayout(() => {
            for (const char of segment.text) {
              const mapped = macKeyForAsciiChar(char);
              if (mapped) {
                postKey(mapped.code, true, mapped.flags);
                postKey(mapped.code, false, mapped.flags);
              } else {
                postUnicodeChar(char);
              }
            }
          });
        } else {
          for (const char of segment.text) postUnicodeChar(char);
        }
      }
    },
    async keyChord(keys) {
      const chord = splitMacChord(keys);
      if (chord.modifiers.length + chord.keys.length === 0) throw new Error('unmapped key chord');
      await withEnglishLayout(() => {
        for (const code of chord.modifiers) postKey(code, true, chord.flags);
        for (const code of chord.keys) {
          postKey(code, true, chord.flags);
          postKey(code, false, chord.flags);
        }
        for (const code of [...chord.modifiers].reverse()) postKey(code, false, 0);
      });
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
      return (await axCall({ op: 'snapshot', pid, maxDepth })) as AxTreeNode[];
    },
    async axQuery(target, query) {
      const { pid } = await windowPid(target);
      return (await axCall({
        op: 'query',
        pid,
        limit: query.limit ?? 20,
        ...(query.role ? { role: query.role } : {}),
        ...(query.title ? { title: query.title } : {}),
        ...(query.value ? { value: query.value } : {}),
        ...(query.description ? { description: query.description } : {}),
      })) as AxTreeNode[];
    },
    async axElementAt(x, y) {
      return (await axCall({ op: 'elementAt', x, y })) as AxTreeNode | null;
    },
    async axFocused() {
      return (await axCall({ op: 'focused' })) as AxTreeNode | null;
    },
    async axNode(handle) {
      return (await axCall({ op: 'node', handle })) as AxTreeNode;
    },
    async axAttributes(handle) {
      return (await axCall({ op: 'attributes', handle })) as Array<[string, string]>;
    },
    async axChildren(handle) {
      return (await axCall({ op: 'children', handle })) as AxTreeNode[];
    },
    async axParent() {
      return null;
    },
    async axPerform(handle, action) {
      await axCall({ op: 'perform', handle, action });
    },
    async axSetValue(handle, value) {
      await axCall({ op: 'setValue', handle, value });
    },
    async axFocus(handle) {
      await axCall({ op: 'focus', handle });
    },
  };
}
