import type { ComputerWindowInfo } from '@shared/computer/types';
import {
  INPUT_SIZE,
  KEYEVENTF_KEYUP,
  KEYEVENTF_UNICODE,
  MOUSEEVENTF_ABSOLUTE,
  MOUSEEVENTF_HWHEEL,
  MOUSEEVENTF_LEFTDOWN,
  MOUSEEVENTF_LEFTUP,
  MOUSEEVENTF_MOVE,
  MOUSEEVENTF_VIRTUALDESK,
  MOUSEEVENTF_WHEEL,
  WHEEL_DELTA,
  absoluteMouseCoords,
  writeKeyboardInput,
  writeMouseInput,
} from './winInput';
import { splitWinChord } from './winKey';

export interface Win32Native {
  windows(): Promise<ComputerWindowInfo[]>;
  virtualScreen(): { x: number; y: number; width: number; height: number };
  click(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  drag(points: Array<{ x: number; y: number }>): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  typeText(text: string): Promise<void>;
  keyChord(keys: string[]): Promise<void>;
  raise(windowId: string): Promise<void>;
}

let cached: Promise<Win32Native | null> | undefined;

export function loadWin32Native(): Promise<Win32Native | null> {
  cached ??= load().catch(() => null);
  return cached;
}

interface KoffiApi {
  load(path: string): {
    func: (name: string, ret: string, args: unknown[]) => (...args: unknown[]) => unknown;
  };
  proto(def: string): unknown;
  pointer(type: unknown): unknown;
  register(fn: (...args: never[]) => unknown, type: unknown): unknown;
  unregister(handle: unknown): void;
}

async function load(): Promise<Win32Native | null> {
  if (process.platform !== 'win32') return null;
  const koffi = (await import('koffi')).default as unknown as KoffiApi;
  const user32 = koffi.load('user32.dll');
  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr lParam)');
  const EnumWindows = user32.func('EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'intptr']);
  const IsWindowVisible = user32.func('IsWindowVisible', 'bool', ['void *']);
  const GetWindow = user32.func('GetWindow', 'void *', ['void *', 'uint32']);
  const GetWindowTextLengthW = user32.func('GetWindowTextLengthW', 'int', ['void *']);
  const GetWindowTextW = user32.func('GetWindowTextW', 'int', ['void *', 'void *', 'int']);
  const GetWindowRect = user32.func('GetWindowRect', 'bool', ['void *', 'void *']);
  const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', [
    'void *',
    'uint32 *',
  ]);
  const SetForegroundWindow = user32.func('SetForegroundWindow', 'bool', ['void *']);
  const ShowWindow = user32.func('ShowWindow', 'bool', ['void *', 'int']);
  const SendInput = user32.func('SendInput', 'uint', ['uint', 'void *', 'int']);
  const GetSystemMetrics = user32.func('GetSystemMetrics', 'int', ['int']);
  const GW_OWNER = 4;
  const SW_RESTORE = 9;

  const hwndPtr = (id: string): unknown => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`window '${id}' not found`);
    return n;
  };

  const readTitle = (hwnd: unknown): string => {
    const len = Number(GetWindowTextLengthW(hwnd));
    if (len <= 0) return '';
    const buf = Buffer.alloc((len + 1) * 2);
    GetWindowTextW(hwnd, buf, len + 1);
    return buf.toString('utf16le').replace(/\0+$/g, '');
  };

  const virtualScreen = () => ({
    x: Number(GetSystemMetrics(76)),
    y: Number(GetSystemMetrics(77)),
    width: Math.max(1, Number(GetSystemMetrics(78))),
    height: Math.max(1, Number(GetSystemMetrics(79))),
  });

  const send = (buf: Buffer, count: number) => {
    const n = Number(SendInput(count, buf, INPUT_SIZE));
    if (n !== count) throw new Error('SendInput failed');
  };

  const mouseTo = (x: number, y: number, extraFlags: number, mouseData = 0) => {
    const screen = virtualScreen();
    const abs = absoluteMouseCoords(x, y, screen);
    const buf = Buffer.alloc(INPUT_SIZE);
    writeMouseInput(
      buf,
      0,
      abs.dx,
      abs.dy,
      MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | extraFlags,
      mouseData
    );
    send(buf, 1);
  };

  const keyEvent = (vk: number, up: boolean, scan = 0, extraFlags = 0) => {
    const buf = Buffer.alloc(INPUT_SIZE);
    writeKeyboardInput(buf, 0, vk, extraFlags | (up ? KEYEVENTF_KEYUP : 0), scan);
    send(buf, 1);
  };

  return {
    virtualScreen,
    async windows() {
      const windows: ComputerWindowInfo[] = [];
      const cb = koffi.register((hwnd: unknown) => {
        if (!IsWindowVisible(hwnd)) return true;
        if (GetWindow(hwnd, GW_OWNER)) return true;
        const title = readTitle(hwnd);
        if (!title) return true;
        const rect = Buffer.alloc(16);
        if (!GetWindowRect(hwnd, rect)) return true;
        const left = rect.readInt32LE(0);
        const top = rect.readInt32LE(4);
        const right = rect.readInt32LE(8);
        const bottom = rect.readInt32LE(12);
        const pidBuf = Buffer.alloc(4);
        GetWindowThreadProcessId(hwnd, pidBuf);
        windows.push({
          id: String(Number(hwnd)),
          app: title,
          title,
          pid: pidBuf.readUInt32LE(0),
          focused: windows.length === 0,
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        });
        return true;
      }, koffi.pointer(EnumWindowsProc));
      try {
        EnumWindows(cb, 0);
      } finally {
        koffi.unregister(cb);
      }
      return windows;
    },
    async click(x, y) {
      mouseTo(x, y, 0);
      mouseTo(x, y, MOUSEEVENTF_LEFTDOWN);
      mouseTo(x, y, MOUSEEVENTF_LEFTUP);
    },
    async move(x, y) {
      mouseTo(x, y, 0);
    },
    async drag(points) {
      if (points.length === 0) return;
      mouseTo(points[0].x, points[0].y, 0);
      mouseTo(points[0].x, points[0].y, MOUSEEVENTF_LEFTDOWN);
      for (const point of points.slice(1)) mouseTo(point.x, point.y, 0);
      const last = points[points.length - 1];
      mouseTo(last.x, last.y, MOUSEEVENTF_LEFTUP);
    },
    async scroll(x, y, dx, dy) {
      mouseTo(x, y, 0);
      if (dy) mouseTo(x, y, MOUSEEVENTF_WHEEL, Math.round(dy) * WHEEL_DELTA);
      if (dx) mouseTo(x, y, MOUSEEVENTF_HWHEEL, Math.round(dx) * WHEEL_DELTA);
    },
    async typeText(text) {
      for (const char of text) {
        const scan = char.codePointAt(0) ?? 0;
        keyEvent(0, false, scan, KEYEVENTF_UNICODE);
        keyEvent(0, true, scan, KEYEVENTF_UNICODE);
      }
    },
    async keyChord(keys) {
      const chord = splitWinChord(keys);
      if (chord.modifiers.length + chord.keys.length === 0) throw new Error('unmapped key chord');
      for (const code of chord.modifiers) keyEvent(code, false);
      for (const code of chord.keys) {
        keyEvent(code, false);
        keyEvent(code, true);
      }
      for (const code of [...chord.modifiers].reverse()) keyEvent(code, true);
    },
    async raise(windowId) {
      const hwnd = hwndPtr(windowId);
      ShowWindow(hwnd, SW_RESTORE);
      SetForegroundWindow(hwnd);
    },
  };
}
