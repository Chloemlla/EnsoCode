import { basename } from 'node:path';
import type { ComputerWindowInfo } from '@shared/computer/types';
import {
  absoluteMouseCoords,
  INPUT_SIZE,
  KEYEVENTF_EXTENDEDKEY,
  KEYEVENTF_KEYUP,
  MOUSEEVENTF_ABSOLUTE,
  MOUSEEVENTF_HWHEEL,
  MOUSEEVENTF_MOVE,
  MOUSEEVENTF_VIRTUALDESK,
  MOUSEEVENTF_WHEEL,
  mouseButtonFlags,
  typeTextKeys,
  type WinKeyEvent,
  wheelSteps,
  writeKeyboardInput,
  writeMouseInput,
} from './winInput';
import { splitWinChord, type WinVk } from './winKey';

export interface WinClickOptions {
  button?: string;
  count?: number;
  modifiers?: string[];
}

/** 坐标一律是物理像素（Electron 进程按 Per-Monitor V2 感知 DPI，与 GetWindowRect/SendInput 同一空间） */
export interface Win32Native {
  windows(): Promise<ComputerWindowInfo[]>;
  virtualScreen(): { x: number; y: number; width: number; height: number };
  click(x: number, y: number, opts?: WinClickOptions): Promise<void>;
  move(x: number, y: number): Promise<void>;
  drag(points: Array<{ x: number; y: number }>): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  typeText(text: string): Promise<void>;
  keyChord(keys: string[]): Promise<void>;
  raise(windowId: string): Promise<void>;
  /** 一次 run 结束：让尚未发完的逐字输入立刻停下 */
  endInput(): void;
}

let cached: Promise<Win32Native | null> | undefined;

export function loadWin32Native(): Promise<Win32Native | null> {
  cached ??= load().catch((error) => {
    console.warn('[computer] Windows native bridge unavailable', error);
    return null;
  });
  return cached;
}

type Fn = (...args: unknown[]) => unknown;
interface KoffiApi {
  load(path: string): { func: (name: string, ret: string, args: string[]) => Fn };
  proto(def: string): unknown;
  pointer(type: unknown): unknown;
  register(fn: (...args: never[]) => unknown, type: unknown): unknown;
  unregister(handle: unknown): void;
}

const GW_OWNER = 4;
const GA_ROOTOWNER = 3;
const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const SW_RESTORE = 9;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TYPE_CHUNK_EVENTS = 32;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function load(): Promise<Win32Native | null> {
  if (process.platform !== 'win32') return null;
  const koffi = (await import('koffi')).default as unknown as KoffiApi;
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  let dwmGetWindowAttribute: Fn | undefined;
  try {
    dwmGetWindowAttribute = koffi
      .load('dwmapi.dll')
      .func('DwmGetWindowAttribute', 'int32', ['intptr', 'uint32', 'void *', 'uint32']);
  } catch {
    dwmGetWindowAttribute = undefined;
  }
  // HWND 用 intptr 收发：void * 在 JS 侧是不透明对象，转数字会变 NaN
  const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(intptr hwnd, intptr lParam)');
  const EnumWindows = user32.func('EnumWindows', 'int', [
    koffi.pointer(EnumWindowsProc) as string,
    'intptr',
  ]);
  const IsWindow = user32.func('IsWindow', 'int', ['intptr']);
  const IsWindowVisible = user32.func('IsWindowVisible', 'int', ['intptr']);
  const IsIconic = user32.func('IsIconic', 'int', ['intptr']);
  const GetWindow = user32.func('GetWindow', 'intptr', ['intptr', 'uint32']);
  const GetAncestor = user32.func('GetAncestor', 'intptr', ['intptr', 'uint32']);
  const GetWindowLongPtrW = user32.func('GetWindowLongPtrW', 'intptr', ['intptr', 'int']);
  const GetWindowTextLengthW = user32.func('GetWindowTextLengthW', 'int', ['intptr']);
  const GetWindowTextW = user32.func('GetWindowTextW', 'int', ['intptr', 'void *', 'int']);
  const GetWindowRect = user32.func('GetWindowRect', 'int', ['intptr', 'void *']);
  const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', [
    'intptr',
    'void *',
  ]);
  const GetForegroundWindow = user32.func('GetForegroundWindow', 'intptr', []);
  const SetForegroundWindow = user32.func('SetForegroundWindow', 'int', ['intptr']);
  const BringWindowToTop = user32.func('BringWindowToTop', 'int', ['intptr']);
  const ShowWindow = user32.func('ShowWindow', 'int', ['intptr', 'int']);
  const AttachThreadInput = user32.func('AttachThreadInput', 'int', ['uint32', 'uint32', 'int']);
  const SendInput = user32.func('SendInput', 'uint32', ['uint32', 'void *', 'int']);
  const GetSystemMetrics = user32.func('GetSystemMetrics', 'int', ['int']);
  const MapVirtualKeyW = user32.func('MapVirtualKeyW', 'uint32', ['uint32', 'uint32']);
  const GetCurrentThreadId = kernel32.func('GetCurrentThreadId', 'uint32', []);
  const OpenProcess = kernel32.func('OpenProcess', 'intptr', ['uint32', 'int', 'uint32']);
  const CloseHandle = kernel32.func('CloseHandle', 'int', ['intptr']);
  const QueryFullProcessImageNameW = kernel32.func('QueryFullProcessImageNameW', 'int', [
    'intptr',
    'uint32',
    'void *',
    'void *',
  ]);

  const num = (value: unknown) => Number(value);
  let inputEpoch = 0;

  const hwndOf = (id: string): number => {
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n <= 0 || !IsWindow(n)) {
      throw new Error(`window '${id}' not found`);
    }
    return n;
  };

  const readTitle = (hwnd: number): string => {
    const len = num(GetWindowTextLengthW(hwnd));
    if (len <= 0) return '';
    const buf = Buffer.alloc((len + 1) * 2);
    GetWindowTextW(hwnd, buf, len + 1);
    return buf.toString('utf16le').replace(/\0+$/g, '');
  };

  const cloaked = (hwnd: number): boolean => {
    if (!dwmGetWindowAttribute) return false;
    const buf = Buffer.alloc(4);
    return (
      num(dwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, buf, 4)) === 0 && buf.readUInt32LE(0) !== 0
    );
  };

  // 可见边框：GetWindowRect 含 Win10+ 的透明缩放边，会让截图坐标整体偏几像素
  const frameRect = (hwnd: number) => {
    const buf = Buffer.alloc(16);
    const ok =
      (dwmGetWindowAttribute &&
        num(dwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, buf, 16)) === 0) ||
      num(GetWindowRect(hwnd, buf)) !== 0;
    if (!ok) return undefined;
    const left = buf.readInt32LE(0);
    const top = buf.readInt32LE(4);
    return {
      x: left,
      y: top,
      width: Math.max(0, buf.readInt32LE(8) - left),
      height: Math.max(0, buf.readInt32LE(12) - top),
    };
  };

  const processName = (pid: number): string | undefined => {
    const handle = num(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
    if (!handle) return undefined;
    try {
      const buf = Buffer.alloc(1024);
      const size = Buffer.alloc(4);
      size.writeUInt32LE(512, 0);
      if (!num(QueryFullProcessImageNameW(handle, 0, buf, size))) return undefined;
      const path = buf.toString('utf16le', 0, size.readUInt32LE(0) * 2);
      return basename(path).replace(/\.exe$/i, '') || undefined;
    } finally {
      CloseHandle(handle);
    }
  };

  const isFront = (hwnd: number): boolean => {
    const fg = num(GetForegroundWindow());
    return fg !== 0 && (fg === hwnd || num(GetAncestor(fg, GA_ROOTOWNER)) === hwnd);
  };

  const virtualScreen = () => ({
    x: num(GetSystemMetrics(76)),
    y: num(GetSystemMetrics(77)),
    width: Math.max(1, num(GetSystemMetrics(78))),
    height: Math.max(1, num(GetSystemMetrics(79))),
  });

  const sendMouse = (events: Array<{ x: number; y: number; flags: number; data?: number }>) => {
    if (events.length === 0) return;
    const screen = virtualScreen();
    const buf = Buffer.alloc(INPUT_SIZE * events.length);
    events.forEach((event, index) => {
      const abs = absoluteMouseCoords(event.x, event.y, screen);
      writeMouseInput(
        buf,
        index * INPUT_SIZE,
        abs.dx,
        abs.dy,
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | event.flags,
        event.data ?? 0
      );
    });
    if (num(SendInput(events.length, buf, INPUT_SIZE)) !== events.length) {
      throw new Error('SendInput was blocked (the target may run as administrator)');
    }
  };

  const sendKeys = (events: WinKeyEvent[]) => {
    if (events.length === 0) return;
    const buf = Buffer.alloc(INPUT_SIZE * events.length);
    events.forEach((event, index) => {
      writeKeyboardInput(buf, index * INPUT_SIZE, event.vk, event.flags, event.scan);
    });
    if (num(SendInput(events.length, buf, INPUT_SIZE)) !== events.length) {
      throw new Error('SendInput was blocked (the target may run as administrator)');
    }
  };

  const vkEvent = (key: WinVk, up: boolean): WinKeyEvent => ({
    vk: key.vk,
    scan: num(MapVirtualKeyW(key.vk, 0)) & 0xffff,
    flags: (key.extended ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0),
  });

  const chordOf = (keys: string[]) => {
    const chord = splitWinChord(keys);
    if (chord.unmapped.length > 0) throw new Error(`unmapped key: ${chord.unmapped.join(', ')}`);
    return chord;
  };

  /** 修饰键按下后执行，无论成败都抬起，避免把 Ctrl/Shift 卡在按下状态 */
  const withModifiers = async (modifiers: WinVk[], fn: () => Promise<void> | void) => {
    sendKeys(modifiers.map((key) => vkEvent(key, false)));
    try {
      await fn();
    } finally {
      sendKeys([...modifiers].reverse().map((key) => vkEvent(key, true)));
    }
  };

  return {
    virtualScreen,
    async windows() {
      const fg = num(GetForegroundWindow());
      const fgRoot = fg ? num(GetAncestor(fg, GA_ROOTOWNER)) : 0;
      const names = new Map<number, string | undefined>();
      const windows: ComputerWindowInfo[] = [];
      // EnumWindows 按 Z 序从前到后，与 mac 的 windows() 顺序一致
      const cb = koffi.register((raw: unknown) => {
        try {
          const hwnd = num(raw);
          if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return 1;
          if (num(GetWindow(hwnd, GW_OWNER))) return 1;
          const exStyle = num(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
          if (exStyle & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT)) return 1;
          if (cloaked(hwnd)) return 1;
          const title = readTitle(hwnd);
          if (!title) return 1;
          const rect = frameRect(hwnd);
          if (!rect || rect.width <= 0 || rect.height <= 0) return 1;
          const pidBuf = Buffer.alloc(4);
          GetWindowThreadProcessId(hwnd, pidBuf);
          const pid = pidBuf.readUInt32LE(0);
          if (!names.has(pid)) names.set(pid, processName(pid));
          windows.push({
            id: String(hwnd),
            app: names.get(pid) ?? title,
            title,
            pid,
            focused: hwnd === fg || hwnd === fgRoot,
            ...rect,
          });
        } catch {
          // 单个窗口读不到不影响其余窗口
        }
        return 1;
      }, koffi.pointer(EnumWindowsProc));
      try {
        EnumWindows(cb, 0);
      } finally {
        koffi.unregister(cb);
      }
      return windows;
    },
    async click(x, y, opts) {
      const button = mouseButtonFlags(opts?.button);
      const count = Math.min(3, Math.max(1, Math.round(opts?.count ?? 1)));
      const modifiers = chordOf(opts?.modifiers ?? []).modifiers;
      sendMouse([{ x, y, flags: 0 }]);
      await withModifiers(modifiers, () => {
        const events = [];
        for (let i = 0; i < count; i += 1) {
          events.push({ x, y, flags: button.down }, { x, y, flags: button.up });
        }
        sendMouse(events);
      });
    },
    async move(x, y) {
      sendMouse([{ x, y, flags: 0 }]);
    },
    async drag(points) {
      if (points.length === 0) return;
      const button = mouseButtonFlags();
      const [first] = points;
      const last = points[points.length - 1];
      sendMouse([{ ...first, flags: 0 }]);
      sendMouse([{ ...first, flags: button.down }]);
      try {
        await sleep(30);
        for (const point of points.slice(1)) {
          sendMouse([{ ...point, flags: 0 }]);
          await sleep(12);
        }
      } finally {
        sendMouse([{ ...last, flags: button.up }]);
      }
    },
    async scroll(x, y, dx, dy) {
      sendMouse([{ x, y, flags: 0 }]);
      // 与 mac 相同：dy>0 向上；mac 的 dx>0 是向左，Windows 水平滚轮正数向右
      sendMouse([
        ...wheelSteps(dy).map((data) => ({ x, y, flags: MOUSEEVENTF_WHEEL, data })),
        ...wheelSteps(-dx).map((data) => ({ x, y, flags: MOUSEEVENTF_HWHEEL, data })),
      ]);
    },
    async typeText(text) {
      const epoch = inputEpoch;
      const events = typeTextKeys(text);
      for (let i = 0; i < events.length; i += TYPE_CHUNK_EVENTS) {
        if (epoch !== inputEpoch) throw new Error('Computer action aborted');
        sendKeys(events.slice(i, i + TYPE_CHUNK_EVENTS));
        await sleep(4);
      }
    },
    async keyChord(keys) {
      const chord = chordOf(keys);
      if (chord.modifiers.length + chord.keys.length === 0) throw new Error('empty key chord');
      await withModifiers(chord.modifiers, () => {
        sendKeys(chord.keys.flatMap((key) => [vkEvent(key, false), vkEvent(key, true)]));
      });
    },
    async raise(windowId) {
      const hwnd = hwndOf(windowId);
      if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
      if (isFront(hwnd)) return;
      SetForegroundWindow(hwnd);
      if (!isFront(hwnd)) {
        // 前台锁：挂到当前前台线程的输入队列上再切，系统才允许本进程改前台
        const fg = num(GetForegroundWindow());
        const fgThread = fg ? num(GetWindowThreadProcessId(fg, null)) : 0;
        const self = num(GetCurrentThreadId());
        const attached =
          fgThread !== 0 && fgThread !== self && num(AttachThreadInput(self, fgThread, 1)) !== 0;
        try {
          BringWindowToTop(hwnd);
          SetForegroundWindow(hwnd);
        } finally {
          if (attached) AttachThreadInput(self, fgThread, 0);
        }
      }
      for (let i = 0; i < 20 && !isFront(hwnd); i += 1) await sleep(50);
    },
    endInput() {
      inputEpoch += 1;
    },
  };
}
