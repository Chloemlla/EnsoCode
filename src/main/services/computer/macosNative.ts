import { execFile } from 'node:child_process';
import type { AxTreeNode } from '@shared/computer/axTree';
import type { ComputerWindowInfo } from '@shared/computer/types';
import { AX_WORKER_TIMEOUT_MS } from './axWalkBudget';
import type { AxWorkerRequest } from './axWorkerClient';
import { createAxWorkerClient, spawnAxWorker } from './axWorkerClient';
import axWorkerPath from './axWorkerThread?modulePath';
import type { PointerOptions } from './backend';
import { decodeCfNumberAsFloat64, kCFNumberFloat64Type } from './cfNumber';
import {
  macClickCount,
  macKeyForAsciiChar,
  macModifierFlags,
  macMouseButton,
  pickEnglishLayoutIndex,
  splitMacChord,
} from './macKey';
import { withMacWindowFocus } from './macWindowFocus';
import {
  SKY_CLICK_UNAVAILABLE,
  type SkyClickEventStep,
  skyClickCgEventType,
  skyClickEventRecipe,
  skyLightActivationRecord,
} from './skyClick';
import { isListedCgWindowLayer } from './windowSource';

export interface MacosNative {
  windows(): Promise<ComputerWindowInfo[]>;
  click(x: number, y: number, opts?: PointerOptions & { pid?: number }): Promise<void>;
  skyClick(input: {
    screenX: number;
    screenY: number;
    windowX: number;
    windowY: number;
    windowId: number;
    pid: number;
    alreadyFront?: boolean;
    count?: number;
  }): Promise<void>;
  move(x: number, y: number): Promise<void>;
  drag(points: Array<{ x: number; y: number }>): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  typeText(text: string): Promise<void>;
  keyChord(keys: string[]): Promise<void>;
  /** run 结束：等已投递的键盘事件被消费后恢复用户原输入法 */
  endInput(): Promise<void>;
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
    symbol(name: string): unknown;
  };
  struct(name: string, fields: Record<string, string>): unknown;
  pointer(ref: unknown, count?: number): unknown;
  out(type: unknown): unknown;
  decode(ref: unknown, type: string): unknown;
}

const RAISE_MESSAGING_TIMEOUT_SEC = 1.5;
const kCGMouseEventClickState = 1;

async function load(): Promise<MacosNative | null> {
  const koffi = (await import('koffi')).default as unknown as KoffiApi;
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const ax = koffi.load(
    '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
  );
  const carbon = koffi.load('/System/Library/Frameworks/Carbon.framework/Carbon');
  const GetFrontProcess = carbon.func('GetFrontProcess', 'int32', ['void *']);
  const GetProcessPID = carbon.func('GetProcessPID', 'int32', ['void *', 'void *']);

  const CGPoint = koffi.struct('CGPoint', { x: 'double', y: 'double' });
  const CGEventCreateMouseEvent = cg.func('CGEventCreateMouseEvent', 'void *', [
    'void *',
    'uint32',
    CGPoint,
    'uint32',
  ]);
  const CGEventPost = cg.func('CGEventPost', 'void', ['uint32', 'void *']);
  const CGEventPostToPid = cg.func('CGEventPostToPid', 'void', ['int32', 'void *']);
  const CGEventSetIntegerValueField = cg.func('CGEventSetIntegerValueField', 'void', [
    'void *',
    'uint32',
    'int64',
  ]);
  const CFRelease = cf.func('CFRelease', 'void', ['void *']);
  const CFRetain = cf.func('CFRetain', 'void *', ['void *']);
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
  const TISCreateInputSourceList = carbon.func('TISCreateInputSourceList', 'void *', [
    'void *',
    'bool',
  ]);
  const TISGetInputSourceProperty = carbon.func('TISGetInputSourceProperty', 'void *', [
    'void *',
    'void *',
  ]);
  const kTISPropertyInputSourceID = koffi.decode(
    carbon.symbol('kTISPropertyInputSourceID'),
    'void *'
  );
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
  // CGEventCreateScrollWheelEvent 是变参函数：arm64 上变参走栈，不能按定参声明
  const createScrollEvent = (() => {
    try {
      const fn = cg.func('CGEventCreateScrollWheelEvent2', 'void *', [
        'void *',
        'uint32',
        'uint32',
        'int32',
        'int32',
        'int32',
      ]);
      return (dy: number, dx: number) => fn(null, 0, 2, dy, dx, 0);
    } catch {
      const fn = cg.func('CGEventCreateScrollWheelEvent', 'void *', [
        'void *',
        'uint32',
        'uint32',
        'int32',
        '...',
      ]);
      return (dy: number, dx: number) => fn(null, 0, 2, dy, 'int32', dx);
    }
  })();
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
  const AXUIElementSetMessagingTimeout = ax.func('AXUIElementSetMessagingTimeout', 'int', [
    'void *',
    'float',
  ]);
  let AXUIElementGetWindow: ((element: unknown, out: Buffer) => unknown) | undefined;
  try {
    AXUIElementGetWindow = ax.func('_AXUIElementGetWindow', 'int', ['void *', 'void *']);
  } catch {
    AXUIElementGetWindow = undefined;
  }
  const kCFStringEncodingUTF8 = 0x08000100;

  const withCfString = <R>(value: string, fn: (ref: unknown) => R): R => {
    const ref = CFStringCreateWithCString(null, value, kCFStringEncodingUTF8);
    if (!ref) throw new Error('CFStringCreateWithCString failed');
    try {
      return fn(ref);
    } finally {
      CFRelease(ref);
    }
  };
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
  const dictGet = (dict: unknown, key: string): unknown =>
    withCfString(key, (cfKey) => CFDictionaryGetValue(dict, cfKey));

  const kCGWindowListOptionOnScreenOnly = 1;
  const kCGWindowListExcludeDesktopElements = 16;
  const kCGHIDEventTap = 0;
  const kCGEventMouseMoved = 5;
  const kCGMouseButtonLeft = 0;
  const LEFT = macMouseButton('left');

  const postMouse = (
    type: number,
    x: number,
    y: number,
    pid?: number,
    extra?: { button?: number; clickState?: number; flags?: number }
  ) => {
    const event = CGEventCreateMouseEvent(
      null,
      type,
      { x, y },
      extra?.button ?? kCGMouseButtonLeft
    );
    if (!event) throw new Error('CGEventCreateMouseEvent failed');
    try {
      if (extra?.clickState) {
        CGEventSetIntegerValueField(event, kCGMouseEventClickState, extra.clickState);
      }
      if (extra?.flags) CGEventSetFlags(event, extra.flags);
      if (typeof pid === 'number' && pid > 0) CGEventPostToPid(pid, event);
      else CGEventPost(kCGHIDEventTap, event);
    } finally {
      CFRelease(event);
    }
  };

  const windowPid = async (
    target: string
  ): Promise<{ pid: number; windowId: number; title: string }> => {
    const windows = await listWindows();
    const found = windows.find((window) => window.id === target);
    if (!found) throw new Error(`window '${target}' not found`);
    if (!found.pid) throw new Error(`window '${target}' has no pid`);
    return { pid: found.pid, windowId: Number(found.id), title: found.title };
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
          focused: false,
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
      return withMacWindowFocus(windows, focusedWindow());
    } finally {
      CFRelease(array);
    }
  };

  const postKey = (code: number, down: boolean, flags = 0) => {
    const event = CGEventCreateKeyboardEvent(null, code, down);
    if (!event) throw new Error('CGEventCreateKeyboardEvent failed');
    try {
      CGEventSetFlags(event, flags);
      CGEventPost(kCGHIDEventTap, event);
    } finally {
      CFRelease(event);
    }
  };
  const releaseKey = (code: number, flags = 0) => {
    try {
      postKey(code, false, flags);
    } catch {
      // 尽力释放，不覆盖原始错误
    }
  };
  const tapKey = (code: number, flags: number) => {
    postKey(code, true, flags);
    releaseKey(code, flags);
  };

  const postUnicodeChar = (char: string) => {
    const buf = Buffer.from(char, 'utf16le');
    const units = buf.length / 2;
    if (units === 0) return;
    for (const down of [true, false]) {
      const event = CGEventCreateKeyboardEvent(null, 0, down);
      if (!event) throw new Error('CGEventCreateKeyboardEvent failed');
      try {
        CGEventKeyboardSetUnicodeString(event, units, buf);
        CGEventPost(kCGHIDEventTap, event);
      } finally {
        CFRelease(event);
      }
    }
  };

  const inputSourceId = (source: unknown): string =>
    source ? readString(TISGetInputSourceProperty(source, kTISPropertyInputSourceID)) : '';
  /** 精确选 ABC / US；都没启用时退回系统给的 ASCII-capable 布局。返回 +1 引用。 */
  const copyEnglishLayout = (): unknown => {
    const list = TISCreateInputSourceList(null, false);
    if (list) {
      try {
        const count = Number(CFArrayGetCount(list));
        const ids: string[] = [];
        for (let i = 0; i < count; i++) ids.push(inputSourceId(CFArrayGetValueAtIndex(list, i)));
        const index = pickEnglishLayoutIndex(ids);
        if (index !== -1) {
          const source = CFArrayGetValueAtIndex(list, index);
          if (source) return CFRetain(source);
        }
      } finally {
        CFRelease(list);
      }
    }
    return TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
  };

  /**
   * 键盘事件按目标 App 处理时的输入源解释，而不是投递时：每次输入后立刻切回会让拼音等
   * 输入法吞进组字缓冲并乱序上屏。所以整次 run 内首次输入时切到英文布局并确认生效，
   * run 结束（输入已被消费）后再恢复。
   */
  let layoutRestore: { original: unknown } | null = null;
  /** endInput 递增：等输入法切换期间 run 已被中止时，挂起的输入不再发送 */
  let inputEpoch = 0;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const currentSourceId = (): string => {
    const now = TISCopyCurrentKeyboardInputSource();
    try {
      return inputSourceId(now);
    } finally {
      if (now) CFRelease(now);
    }
  };
  const ensureEnglishLayout = async (): Promise<void> => {
    if (layoutRestore) return;
    const current = TISCopyCurrentKeyboardInputSource();
    const english = copyEnglishLayout();
    try {
      const target = english ? inputSourceId(english) : '';
      if (!target || target === inputSourceId(current)) {
        layoutRestore = { original: null };
        return;
      }
      if (Number(TISSelectInputSource(english)) !== 0) {
        layoutRestore = { original: null };
        return;
      }
      layoutRestore = { original: current ? CFRetain(current) : null };
      for (let i = 0; i < 20 && currentSourceId() !== target; i++) await sleep(25);
      await sleep(300);
    } finally {
      if (english) CFRelease(english);
      if (current) CFRelease(current);
    }
  };
  const withEnglishLayout = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const epoch = inputEpoch;
    await ensureEnglishLayout();
    if (epoch !== inputEpoch) throw new Error('Computer action aborted');
    return fn();
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

  let sky: {
    setIntegerField: (event: unknown, field: number, value: number) => void;
    setWindowLocation: (event: unknown, x: number, y: number) => void;
    postEventRecord: (psn: unknown, record: unknown) => number;
    getProcessForPID: (pid: number, psn: unknown) => number;
  } | null = null;
  let slPostToPid: ((pid: number, event: unknown) => void) | undefined;
  try {
    const sl = koffi.load('/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight');
    sky = {
      setIntegerField: sl.func('SLEventSetIntegerValueField', 'void', [
        'void *',
        'uint32',
        'int64',
      ]) as (event: unknown, field: number, value: number) => void,
      setWindowLocation: sl.func('CGEventSetWindowLocation', 'void', [
        'void *',
        'double',
        'double',
      ]) as (event: unknown, x: number, y: number) => void,
      postEventRecord: sl.func('SLPSPostEventRecordTo', 'int32', ['void *', 'void *']) as (
        psn: unknown,
        record: unknown
      ) => number,
      getProcessForPID: carbon.func('GetProcessForPID', 'int32', ['int32', 'void *']) as (
        pid: number,
        psn: unknown
      ) => number,
    };
    try {
      slPostToPid = sl.func('SLEventPostToPid', 'void', ['int32', 'void *']) as (
        pid: number,
        event: unknown
      ) => void;
    } catch {
      slPostToPid = undefined;
    }
  } catch {
    sky = null;
  }
  // 每个事件只投递一次：优先 SLEventPostToPid，不可用时退回 CGEventPostToPid
  const postToPidOnce = (pid: number, event: unknown) => {
    if (slPostToPid) {
      try {
        slPostToPid(pid, event);
        return;
      } catch {
        // FFI 调用失败才退回，避免双投递
      }
    }
    CGEventPostToPid(pid, event);
  };

  const raiseWindow = (pid: number, windowId: number, title: string) => {
    const app = AXUIElementCreateApplication(pid);
    if (!app) throw new Error('AXUIElementCreateApplication failed');
    try {
      AXUIElementSetMessagingTimeout(app, RAISE_MESSAGING_TIMEOUT_SEC);
      withCfString('AXRaise', (raiseAttr) => {
        const out = [null];
        const status = withCfString('AXWindows', (windowsAttr) =>
          Number(AXUIElementCopyAttributeValue(app, windowsAttr, out))
        );
        const array = status === 0 ? out[0] : null;
        if (array) {
          try {
            const count = Number(CFArrayGetCount(array));
            const windows: unknown[] = [];
            for (let i = 0; i < count; i++) {
              const item = CFArrayGetValueAtIndex(array, i);
              if (item) windows.push(item);
            }
            const target =
              windows.find((item) => axWindowId(item) === windowId) ??
              (title ? windows.find((item) => axTitle(item) === title) : undefined) ??
              windows[0];
            if (target) AXUIElementPerformAction(target, raiseAttr);
          } finally {
            CFRelease(array);
          }
        }
        AXUIElementPerformAction(app, raiseAttr);
      });
    } finally {
      CFRelease(app);
    }
  };
  const axWindowId = (element: unknown): number | undefined => {
    if (!AXUIElementGetWindow) return undefined;
    try {
      const buf = Buffer.alloc(4);
      return Number(AXUIElementGetWindow(element, buf)) === 0 ? buf.readUInt32LE(0) : undefined;
    } catch {
      return undefined;
    }
  };
  const focusedWindow = (): { pid: number; windowId: string } | undefined => {
    const psn = Buffer.alloc(8);
    const pidBuffer = Buffer.alloc(4);
    if (Number(GetFrontProcess(psn)) !== 0 || Number(GetProcessPID(psn, pidBuffer)) !== 0) return;
    const pid = pidBuffer.readInt32LE();
    if (pid <= 0) return;
    const app = AXUIElementCreateApplication(pid);
    if (!app) return;
    try {
      AXUIElementSetMessagingTimeout(app, RAISE_MESSAGING_TIMEOUT_SEC);
      const out = [null];
      const status = withCfString('AXFocusedWindow', (attr) =>
        Number(AXUIElementCopyAttributeValue(app, attr, out))
      );
      if (status !== 0 || !out[0]) return;
      try {
        const windowId = axWindowId(out[0]);
        // 焦点不可读时拒绝输入，不能用浮层 z-order 或同进程其他窗口猜测。
        return windowId ? { pid, windowId: String(windowId) } : undefined;
      } finally {
        CFRelease(out[0]);
      }
    } finally {
      CFRelease(app);
    }
  };
  const axTitle = (element: unknown): string => {
    const out = [null];
    const status = withCfString('AXTitle', (attr) =>
      Number(AXUIElementCopyAttributeValue(element, attr, out))
    );
    if (status !== 0 || !out[0]) return '';
    try {
      return readString(out[0]);
    } finally {
      CFRelease(out[0]);
    }
  };

  return {
    windows: listWindows,
    async click(x, y, opts) {
      const pid = typeof opts?.pid === 'number' && opts.pid > 0 ? opts.pid : undefined;
      const button = macMouseButton(opts?.button);
      const count = macClickCount(opts?.count);
      const flags = macModifierFlags(opts?.modifiers);
      postMouse(kCGEventMouseMoved, x, y, pid, { flags });
      for (let clickState = 1; clickState <= count; clickState++) {
        const extra = { button: button.button, clickState, flags };
        postMouse(button.down, x, y, pid, extra);
        postMouse(button.up, x, y, pid, extra);
      }
    },
    async skyClick(input) {
      if (!sky) throw new Error(SKY_CLICK_UNAVAILABLE);
      const skyApi = sky;
      const count = input.count ?? 1;
      const recipe = skyClickEventRecipe(count);
      const psn = Buffer.alloc(8);
      if (!input.alreadyFront) {
        const status = Number(skyApi.getProcessForPID(input.pid, psn));
        if (status !== 0) throw new Error(`${SKY_CLICK_UNAVAILABLE}: PSN ${status}`);
        const activate = Buffer.from(skyLightActivationRecord(input.windowId, true));
        const activateStatus = Number(skyApi.postEventRecord(psn, activate));
        if (activateStatus !== 0)
          throw new Error(`${SKY_CLICK_UNAVAILABLE}: focus ${activateStatus}`);
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
      }
      const clickGroupId = Date.now() % 1_000_000_000;
      const postStep = (step: SkyClickEventStep) => {
        const target = step.pointKind === 'target';
        const screen = target ? { x: input.screenX, y: input.screenY } : { x: -1, y: -1 };
        const windowPoint = target ? { x: input.windowX, y: input.windowY } : { x: -1, y: -1 };
        const event = CGEventCreateMouseEvent(
          null,
          skyClickCgEventType(step.kind),
          screen,
          kCGMouseButtonLeft
        );
        if (!event) throw new Error('CGEventCreateMouseEvent failed');
        try {
          skyApi.setIntegerField(event, 0, step.phase);
          skyApi.setIntegerField(event, 1, step.clickState);
          skyApi.setIntegerField(event, 3, 0);
          skyApi.setIntegerField(event, 7, 3);
          skyApi.setIntegerField(event, 40, input.pid);
          skyApi.setIntegerField(event, 51, input.windowId);
          skyApi.setIntegerField(event, 58, clickGroupId);
          skyApi.setIntegerField(event, 91, input.windowId);
          skyApi.setIntegerField(event, 92, input.windowId);
          skyApi.setWindowLocation(event, windowPoint.x, windowPoint.y);
          postToPidOnce(input.pid, event);
        } finally {
          CFRelease(event);
        }
      };
      let openDown: SkyClickEventStep | undefined;
      try {
        for (const step of recipe) {
          postStep(step);
          if (step.kind === 'down') openDown = step;
          else if (step.kind === 'up') openDown = undefined;
          if (step.delayAfterMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, step.delayAfterMs));
          }
        }
      } finally {
        if (openDown) {
          try {
            postStep({ ...openDown, kind: 'up', delayAfterMs: 0 });
          } catch {
            // 尽力补发 mouseUp
          }
        }
        if (!input.alreadyFront) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          const deactivate = Buffer.from(skyLightActivationRecord(input.windowId, false));
          skyApi.postEventRecord(psn, deactivate);
          await new Promise<void>((resolve) => setTimeout(resolve, 40));
        }
      }
    },
    async move(x, y) {
      postMouse(kCGEventMouseMoved, x, y);
    },
    async drag(points) {
      if (points.length === 0) return;
      postMouse(kCGEventMouseMoved, points[0].x, points[0].y);
      postMouse(LEFT.down, points[0].x, points[0].y);
      let last = points[0];
      try {
        for (const point of points.slice(1)) {
          postMouse(LEFT.dragged, point.x, point.y);
          last = point;
        }
      } finally {
        postMouse(LEFT.up, last.x, last.y);
      }
    },
    async scroll(x, y, dx, dy) {
      postMouse(kCGEventMouseMoved, x, y);
      const event = createScrollEvent(Math.round(dy), Math.round(dx));
      if (!event) throw new Error('CGEventCreateScrollWheelEvent failed');
      try {
        CGEventPost(kCGHIDEventTap, event);
      } finally {
        CFRelease(event);
      }
    },
    async typeText(text) {
      if (!text) return;
      // 整段（含非 ASCII）都在英文布局下注入，避免拼音输入法拦截 keycode 0 的 Unicode 事件
      await withEnglishLayout(() => {
        for (const char of text) {
          const mapped = macKeyForAsciiChar(char);
          if (mapped) tapKey(mapped.code, mapped.flags);
          else postUnicodeChar(char);
        }
      });
    },
    async keyChord(keys) {
      const chord = splitMacChord(keys);
      if (chord.modifiers.length + chord.keys.length === 0) throw new Error('unmapped key chord');
      await withEnglishLayout(() => {
        const held: number[] = [];
        try {
          for (const code of chord.modifiers) {
            postKey(code, true, chord.flags);
            held.push(code);
          }
          for (const code of chord.keys) tapKey(code, chord.flags);
        } finally {
          for (const code of held.reverse()) releaseKey(code);
        }
      });
    },
    async endInput() {
      inputEpoch += 1;
      const restore = layoutRestore;
      layoutRestore = null;
      if (!restore?.original) return;
      await sleep(200);
      try {
        TISSelectInputSource(restore.original);
      } finally {
        CFRelease(restore.original);
      }
    },
    async raise(windowId) {
      const { pid, windowId: cgWindowId, title } = await windowPid(windowId);
      raiseWindow(pid, cgWindowId, title);
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
