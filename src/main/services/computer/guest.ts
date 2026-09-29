import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { formatAxTree, formatAxTreeDiff } from '@shared/computer/axTree';
import { ReadOnlyError } from '@shared/computer/errors';
import { type CaptureFrame, mapScreenshotPoint, pixelFingerprint } from '@shared/computer/frame';
import { COORDINATE_SAFE_MAX_HEIGHT, COORDINATE_SAFE_MAX_WIDTH } from '@shared/computer/params';
import { isReadOnlyAllowed } from '@shared/computer/readOnly';
import type { ComputerRunResult, ComputerScreenshot } from '@shared/computer/types';
import { JSException, type JSValueHandle, QuickJS } from 'quickjs-wasi';
import { describeAxOutcome } from './axStatus';
import type { DesktopBackend, PointerOptions } from './backend';
import { cropPngAround } from './clickCrop';
import { resolveMacKey } from './macKey';
import { isProtectedAuthText, PROTECTED_SETTING_MESSAGE } from './protectedSetting';
import { normalizeScrollDelta } from './scrollDelta';
import { matchWindow, resolveWindow } from './windowMatch';

const require = createRequire(import.meta.url);
let wasmModule: Promise<WebAssembly.Module> | undefined;

function loadQuickJsWasm(): Promise<WebAssembly.Module> {
  wasmModule ??= readFile(require.resolve('quickjs-wasi/quickjs.wasm')).then((bytes) =>
    WebAssembly.compile(bytes)
  );
  return wasmModule;
}

interface HostCall {
  id: string;
  method: string;
  args: unknown;
}

export interface ComputerGuestSession {
  frames: Map<string, CaptureFrame>;
  lastHash: Map<string, string>;
  lastFocusedId?: string;
  vm?: QuickJS;
  primed?: boolean;
  host?: GuestHostBridge;
  clock?: GuestClock;
  lastAx?: Map<string, string>;
}

interface GuestHostBridge {
  queue: HostCall[];
  nextId: number;
}

interface GuestClock {
  timeoutMs: number;
  signal?: AbortSignal;
  started: number;
  pausedMs: number;
  pauseStarted: number;
  hostInflight: number;
}

export function createComputerGuestSession(): ComputerGuestSession {
  return { frames: new Map(), lastHash: new Map() };
}

export function disposeComputerGuestVm(session: ComputerGuestSession): void {
  try {
    session.vm?.dispose();
  } catch {
    // ignore
  }
  session.vm = undefined;
  session.primed = false;
  session.host = undefined;
}

function jsonClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pointerOpts(raw: unknown): PointerOptions | undefined {
  const record = asRecord(raw);
  const delivery = record.delivery === 'background' ? 'background' : 'foreground';
  return {
    delivery,
    ...(typeof record.button === 'string' ? { button: record.button } : {}),
    ...(typeof record.count === 'number' ? { count: record.count } : {}),
    ...(Array.isArray(record.modifiers)
      ? { modifiers: record.modifiers.filter((item): item is string => typeof item === 'string') }
      : {}),
  };
}

function applyFocus<T extends { id: string; focused?: boolean }>(
  windows: T[],
  lastFocusedId?: string
): T[] {
  if (!lastFocusedId) return windows;
  return windows.map((window) => ({ ...window, focused: window.id === lastFocusedId }));
}

export const DEFAULT_SETTLE_MS = 120;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortableDelay(
  ms: number,
  signal: AbortSignal | undefined,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error('Computer action aborted'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new Error('Computer action aborted'));
    signal?.addEventListener('abort', onAbort);
    void sleep(ms).then(
      () => finish(),
      (error) => finish(error instanceof Error ? error : new Error(String(error)))
    );
  });
}

function appLaunchName(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  const record = asRecord(raw);
  for (const key of ['app', 'name', 'query'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

async function probePixels(
  backend: DesktopBackend,
  session: ComputerGuestSession,
  target: string
): Promise<{
  beforeHash?: string;
  afterHash?: string;
  pixelsChanged: boolean;
  png?: Buffer;
}> {
  const beforeHash = session.lastHash.get(target);
  try {
    const frame = await backend.capture(
      target,
      COORDINATE_SAFE_MAX_WIDTH,
      COORDINATE_SAFE_MAX_HEIGHT
    );
    const afterHash = pixelFingerprint(frame.png.toString('base64'));
    session.lastHash.set(target, afterHash);
    return {
      beforeHash,
      afterHash,
      pixelsChanged: Boolean(beforeHash) && beforeHash !== afterHash,
      png: frame.png,
    };
  } catch {
    return { beforeHash, pixelsChanged: false };
  }
}

const PRELUDE = `
const __ensoWaiters = new Map();
globalThis.__ensoSettle = (id, ok, json) => {
  const waiter = __ensoWaiters.get(id);
  if (!waiter) return;
  __ensoWaiters.delete(id);
  if (ok) waiter.resolve(JSON.parse(json));
  else waiter.reject(Object.assign(new Error(JSON.parse(json).message), JSON.parse(json)));
};
function host(method, args) {
  const id = __ensoHost(method, JSON.stringify(args === undefined ? {} : args));
  return new Promise((resolve, reject) => __ensoWaiters.set(id, { resolve, reject }));
}
function el(node) {
  if (!node) return null;
  return {
    ref: node.ref,
    role: node.role,
    title: node.title,
    value: node.value,
    description: node.description,
    get bounds() { return host('axBounds', { ref: node.ref }); },
    attributes() { return host('axAttributes', { ref: node.ref }); },
    actions() { return host('axActions', { ref: node.ref }); },
    parent() { return host('axParent', { ref: node.ref }).then(el); },
    children() { return host('axChildren', { ref: node.ref }).then((xs) => xs.map(el)); },
    perform(action) { return host('axPerform', { ref: node.ref, action: String(action) }); },
    press() { return host('axPerform', { ref: node.ref, action: 'press' }); },
    click(opts) { return host('axClick', { ref: node.ref, ...(opts || {}) }); },
    focus() { return host('axFocus', { ref: node.ref }); },
    setValue(value) { return host('axSetValue', { ref: node.ref, value: String(value) }); },
  };
}
function win(info) {
  const id = info.id;
  return {
    ...info,
    screenshot(opts) { return host('screenshot', { target: id, silent: !!(opts && opts.silent) }); },
    getState(opts) { return host('getState', { target: id, ...(opts || {}) }); },
    ax(opts) { return host('ax', { target: id, ...(opts || {}) }); },
    find(query) { const q = typeof query === 'string' ? { description: query } : (query || {}); return host('find', { target: id, ...q }).then((xs) => (Array.isArray(xs) ? xs : []).map(el)); },
    ref(reference) { return host('ref', { ref: String(reference) }).then(el); },
    click(x, y, opts) { return host('click', { target: id, x, y, ...(opts || {}) }); },
    doubleClick(x, y, opts) { return host('click', { target: id, x, y, count: 2, ...(opts || {}) }); },
    move(x, y, opts) { return host('move', { target: id, x, y, ...(opts || {}) }); },
    drag(points, opts) { return host('drag', { target: id, points, ...(opts || {}) }); },
    scroll(x, y, dxOrOpts, dy) {
      if (typeof dxOrOpts === 'number' || typeof dy === 'number') {
        return host('scroll', { target: id, x, y, dx: Number(dxOrOpts) || 0, dy: Number(dy) || 0 });
      }
      return host('scroll', { target: id, x, y, ...(dxOrOpts || {}) });
    },
    type(text, opts) { return host('type', { target: id, text: String(text), ...(opts || {}) }); },
    press(chord, opts) { return host('press', { target: id, chord, ...(opts || {}) }); },
    raise() { return host('raise', { target: id }).then(win); },
  };
}
globalThis.desktop = {
  windows(filter) { return host('windows', filter || {}).then((xs) => (Array.isArray(xs) ? xs : []).map(win)); },
  async window(idOrFilter) { return win(await host('window', idOrFilter)); },
  async app(idOrFilter, opts) { return win(await host('app', { ...(typeof idOrFilter === 'string' ? { app: idOrFilter } : (idOrFilter || {})), ...(opts || {}) })); },
  async focusedWindow() { return win(await host('focusedWindow', {})); },
  async focused() { return win(await host('focusedWindow', {})); },
  displays() { return host('displays', {}); },
  capabilities() { return host('capabilities', {}); },
  screenshot(opts) { return host('screenshot', { target: 'desktop', silent: !!(opts && opts.silent) }); },
  click(x, y, opts) { return host('click', { target: 'desktop', x, y, ...(opts || {}) }); },
  type(text, opts) { return host('type', { target: 'desktop', text: String(text), ...(opts || {}) }); },
  press(chord, opts) { return host('press', { target: 'desktop', chord, ...(opts || {}) }); },
  elementAt(x, y) { return host('elementAt', { x, y }).then((n) => n ? el(n) : { axUnavailable: true, message: 'AX unavailable on this target' }); },
  focusedElement() { return host('focusedElement', {}).then((n) => n ? el(n) : { axUnavailable: true, message: 'AX unavailable on this target' }); },
  clipboard: Object.assign(function clipboard() { return globalThis.desktop.clipboard; }, {
    read() { return host('clipboard.read', {}); },
    write(text) { return host('clipboard.write', { text: String(text) }); },
  }),
};
globalThis.assert = (cond, message) => {
  if (!cond) throw new Error(message || 'assertion failed');
};
globalThis.wait = async (arg, opts) => {
  if (typeof arg === 'number') {
    await host('wait', { ms: arg });
    return;
  }
  const timeout = opts && opts.timeout > 0 ? opts.timeout : 10000;
  const interval = opts && opts.interval > 0 ? opts.interval : 100;
  const start = Date.now();
  while (true) {
    const value = await arg();
    if (value) return value;
    if (Date.now() - start >= timeout) throw new Error('wait timed out');
    await host('wait', { ms: interval });
  }
};
const __noConsole = () => { throw new Error('No console; use return / assert'); };
globalThis.console = { log: __noConsole, info: __noConsole, warn: __noConsole, error: __noConsole, debug: __noConsole };
`;

export async function runComputerGuest(input: {
  code: string;
  readOnly: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  backend: DesktopBackend;
  session: ComputerGuestSession;
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
  occupancy?: { beginSynthetic(): void; endSynthetic(): void };
  persistVm?: boolean;
}): Promise<ComputerRunResult> {
  const screenshots: ComputerScreenshot[] = [];
  const logs: string[] = [];
  const session = input.session;
  session.host ??= { queue: [], nextId: 0 };
  session.host.queue.length = 0;
  session.host.nextId = 0;
  const queue = session.host.queue;
  const clock: GuestClock = {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    started: performance.now(),
    pausedMs: 0,
    pauseStarted: 0,
    hostInflight: 0,
  };
  session.clock = clock;

  const settleMs = input.settleMs ?? DEFAULT_SETTLE_MS;
  const sleep = input.sleep ?? defaultSleep;
  const settle = async () => {
    if (settleMs > 0) await abortableDelay(settleMs, input.signal, sleep);
  };
  const withSynthetic = async <T>(fn: () => Promise<T>): Promise<T> => {
    input.occupancy?.beginSynthetic();
    try {
      return await fn();
    } finally {
      input.occupancy?.endSynthetic();
    }
  };
  const throwIfProtected = async (axText?: string) => {
    const listed = await input.backend.windows();
    const blob = [axText ?? '', ...listed.map((window) => `${window.app}\n${window.title}`)].join(
      '\n'
    );
    if (isProtectedAuthText(blob)) throw new Error(PROTECTED_SETTING_MESSAGE);
  };

  const vm =
    input.persistVm && session.vm
      ? session.vm
      : await QuickJS.create({
          wasm: await loadQuickJsWasm(),
          memoryLimit: 32 * 1024 * 1024,
          interruptHandler: () => {
            const c = session.clock;
            if (!c) return true;
            const now = performance.now();
            const ran =
              now - c.started - c.pausedMs - (c.pauseStarted === 0 ? 0 : now - c.pauseStarted);
            return ran > c.timeoutMs || Boolean(c.signal?.aborted);
          },
        });
  if (input.persistVm) session.vm = vm;

  const pause = () => {
    if (clock.hostInflight++ === 0) clock.pauseStarted = performance.now();
  };
  const resume = () => {
    if (clock.hostInflight === 0) return;
    clock.hostInflight -= 1;
    if (clock.hostInflight > 0) return;
    if (clock.pauseStarted === 0) return;
    clock.pausedMs += performance.now() - clock.pauseStarted;
    clock.pauseStarted = 0;
  };

  const capabilities = await input.backend.capabilities();

  try {
    if (!session.primed) {
      vm.newFunction('__ensoHost', (methodHandle: JSValueHandle, argsHandle: JSValueHandle) => {
        const method = methodHandle.toString();
        let args: unknown = {};
        try {
          args = JSON.parse(argsHandle.toString()) as unknown;
        } catch {
          args = {};
        }
        const id = String(++session.host!.nextId);
        session.host!.queue.push({ id, method, args });
        return vm.newString(id);
      }).consume((handle) => vm.global.setProp('__ensoHost', handle));
      vm.evalCode(PRELUDE, 'enso-computer:prelude.js').dispose();
      session.primed = true;
    } else {
      vm.evalCode('if (globalThis.__ensoWaiters) globalThis.__ensoWaiters.clear();').dispose();
    }
    const resultHandle = vm.evalCode(`(async () => {\n${input.code}\n})()`, 'enso-computer.js');
    const done = vm.resolvePromise(resultHandle);
    let settled: Awaited<typeof done> | undefined;
    const finish = done.then((value) => {
      settled = value;
      return value;
    });

    const settleJob = (id: string, ok: boolean, payload: unknown) => {
      const settle = vm.global.getProp('__ensoSettle');
      const idHandle = vm.newString(id);
      const jsonHandle = vm.newString(JSON.stringify(payload));
      try {
        vm.callFunction(
          settle,
          vm.undefined,
          idHandle,
          ok ? vm.true : vm.false,
          jsonHandle
        ).dispose();
      } finally {
        settle.dispose();
        idHandle.dispose();
        jsonHandle.dispose();
      }
    };

    const dispatch = async (method: string, raw: unknown): Promise<unknown> => {
      if (input.readOnly && !isReadOnlyAllowed(method)) throw new ReadOnlyError(method);
      if (input.signal?.aborted) throw new Error('Computer action aborted');
      const args = asRecord(raw);
      switch (method) {
        case 'capabilities':
          return capabilities;
        case 'displays':
          return input.backend.displays();
        case 'windows': {
          const all = await input.backend.windows();
          return applyFocus(
            all.filter((window) => matchWindow(window, args)),
            input.session.lastFocusedId
          );
        }
        case 'window': {
          const all = await input.backend.windows();
          const found = resolveWindow(all, raw);
          if (!found) throw new Error('no window matched the filter');
          return applyFocus([found], input.session.lastFocusedId)[0];
        }
        case 'focusedWindow': {
          const all = await input.backend.windows();
          const focused =
            applyFocus(all, input.session.lastFocusedId).find((window) => window.focused) ?? all[0];
          if (!focused) throw new Error('no focused window');
          return focused;
        }
        case 'app': {
          const name = appLaunchName(raw);
          if (!name) throw new Error('app requires a name');
          const find = async () => {
            const all = await input.backend.windows();
            const found = resolveWindow(all, { app: name });
            return found ? applyFocus([found], input.session.lastFocusedId)[0] : undefined;
          };
          const existing = await find();
          const pane = typeof args.pane === 'string' ? args.pane.trim() : '';
          if (existing && !pane) return existing;
          if (input.readOnly) throw new ReadOnlyError('app');
          await input.backend.launchApp(name, pane ? { pane } : undefined);
          const deadline = Date.now() + 8_000;
          while (true) {
            if (input.signal?.aborted) throw new Error('Computer action aborted');
            const opened = await find();
            if (opened) {
              await settle();
              return opened;
            }
            if (Date.now() >= deadline) throw new Error(`app '${name}' did not open a window`);
            await abortableDelay(200, input.signal, sleep);
          }
          throw new Error(`app '${name}' did not open a window`);
        }
        case 'screenshot': {
          const target = typeof args.target === 'string' ? args.target : 'desktop';
          const silent = args.silent === true;
          const frame = await input.backend.capture(
            target,
            COORDINATE_SAFE_MAX_WIDTH,
            COORDINATE_SAFE_MAX_HEIGHT
          );
          input.session.frames.set(target, {
            target,
            width: frame.width,
            height: frame.height,
            sourceWidth: frame.sourceWidth,
            sourceHeight: frame.sourceHeight,
            originX: frame.originX,
            originY: frame.originY,
          });
          const shot: ComputerScreenshot = {
            mimeType: 'image/png',
            data: frame.png.toString('base64'),
            width: frame.width,
            height: frame.height,
            sourceWidth: frame.sourceWidth,
            sourceHeight: frame.sourceHeight,
            target,
            ...(silent ? { silent: true } : {}),
          };
          if (!silent) screenshots.push(shot);
          const scale = frame.width > 0 ? frame.sourceWidth / frame.width : 1;
          const hash = pixelFingerprint(shot.data);
          input.session.lastHash.set(target, hash);
          return {
            width: frame.width,
            height: frame.height,
            sourceWidth: frame.sourceWidth,
            sourceHeight: frame.sourceHeight,
            scale: Number(scale.toFixed(2)),
            hash,
            target,
          };
        }
        case 'getState': {
          const [shot, ax] = await Promise.all([dispatch('screenshot', raw), dispatch('ax', raw)]);
          return { ...asRecord(shot), ax };
        }
        case 'click':
        case 'move': {
          const target = String(args.target ?? '');
          const mapped = mapScreenshotPoint(
            input.session.frames,
            target,
            Number(args.x),
            Number(args.y)
          );
          const opts = pointerOpts(args);
          if (method === 'move')
            await withSynthetic(() =>
              input.backend.move(target, mapped.screenX, mapped.screenY, opts)
            );
          else
            await withSynthetic(() =>
              input.backend.click(target, mapped.screenX, mapped.screenY, opts)
            );
          if (method === 'click') await settle();
          if (method === 'click') await throwIfProtected();
          const probe: Partial<Awaited<ReturnType<typeof probePixels>>> =
            method === 'click' ? await probePixels(input.backend, input.session, target) : {};
          const { png, ...hashProbe } = probe;
          if (png && method === 'click') {
            const crop = cropPngAround(png, Number(args.x), Number(args.y));
            if (crop) {
              screenshots.push({
                mimeType: 'image/png',
                data: crop.png.toString('base64'),
                width: crop.width,
                height: crop.height,
                sourceWidth: crop.width,
                sourceHeight: crop.height,
                target: `${target}@click`,
              });
            }
          }
          return {
            ok: true,
            target,
            x: Number(args.x),
            y: Number(args.y),
            screenX: mapped.screenX,
            screenY: mapped.screenY,
            delivery: opts?.delivery ?? 'foreground',
            clickSpace: target,
            hashNote: 'afterHash is immediate; next screenshot() is the current frame',
            ...hashProbe,
          };
        }
        case 'drag': {
          const target = String(args.target ?? '');
          const points = Array.isArray(args.points) ? args.points : [];
          const mapped = points.map((point) => {
            const record = asRecord(point);
            return mapScreenshotPoint(
              input.session.frames,
              target,
              Number(record.x),
              Number(record.y)
            );
          });
          await withSynthetic(() =>
            input.backend.drag(
              target,
              mapped.map((point) => ({ x: point.screenX, y: point.screenY })),
              pointerOpts(args)
            )
          );
          await settle();
          return { ok: true };
        }
        case 'scroll': {
          const target = String(args.target ?? '');
          const mapped = mapScreenshotPoint(
            input.session.frames,
            target,
            Number(args.x),
            Number(args.y)
          );
          const delta = normalizeScrollDelta(args);
          await withSynthetic(() =>
            input.backend.scroll(
              target,
              mapped.screenX,
              mapped.screenY,
              delta.dx,
              delta.dy,
              pointerOpts(args)
            )
          );
          await settle();
          const probe = await probePixels(input.backend, input.session, target);
          const { png: _png, ...hashProbe } = probe;
          return {
            ok: true,
            target,
            x: Number(args.x),
            y: Number(args.y),
            screenX: mapped.screenX,
            screenY: mapped.screenY,
            dx: delta.dx,
            dy: delta.dy,
            delivery: pointerOpts(args)?.delivery ?? 'foreground',
            hashNote: 'afterHash is immediate; next screenshot() is the current frame',
            ...hashProbe,
          };
        }
        case 'type':
          await withSynthetic(() =>
            input.backend.typeText(
              String(args.target ?? ''),
              String(args.text ?? ''),
              pointerOpts(args)
            )
          );
          await settle();
          return {
            ok: true,
            target: String(args.target ?? ''),
            chars: String(args.text ?? '').length,
            delivery: pointerOpts(args)?.delivery ?? 'foreground',
            ax: 'no AX, assumed keystrokes delivered',
          };
        case 'press': {
          const chord = args.chord;
          const keys =
            typeof chord === 'string'
              ? chord
                  .split('+')
                  .map((key) => key.trim())
                  .filter(Boolean)
              : Array.isArray(chord)
                ? chord.filter((key): key is string => typeof key === 'string')
                : [];
          await withSynthetic(() =>
            input.backend.keyChord(String(args.target ?? ''), keys, pointerOpts(args))
          );
          await settle();
          return {
            ok: true,
            target: String(args.target ?? ''),
            keys,
            mapped: keys.map((key) => {
              const resolved = resolveMacKey(key);
              return { key, code: resolved.code ?? null, modifier: resolved.modifier };
            }),
            unmapped: keys.filter((key) => resolveMacKey(key).code === undefined),
            delivery: pointerOpts(args)?.delivery ?? 'foreground',
          };
        }
        case 'raise': {
          const raised = String(args.target ?? '');
          await input.backend.raise(raised);
          input.session.lastFocusedId = raised;
          await settle();
          const raisedWindows = await input.backend.windows();
          const raisedWindow =
            raisedWindows.find((window) => window.id === raised) ??
            raisedWindows.find((window) => window.focused) ??
            raisedWindows[0];
          return raisedWindow ? { ...raisedWindow, focused: true } : { id: raised, focused: true };
        }
        case 'ax': {
          try {
            const nodes = await input.backend.axSnapshot(String(args.target ?? ''), {
              maxDepth: typeof args.maxDepth === 'number' ? args.maxDepth : undefined,
              all: args.all === true,
            });
            const text =
              formatAxTree(nodes) ||
              (describeAxOutcome({ trusted: true, status: 0, nodeCount: 0 }) ?? '');
            await throwIfProtected(text);
            const target = String(args.target ?? '');
            const disableDiff = args.diff === false || args.disableDiff === true;
            session.lastAx ??= new Map();
            const prev = session.lastAx.get(target);
            session.lastAx.set(target, text);
            return !disableDiff && prev ? formatAxTreeDiff(prev, text) : text;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const name = error instanceof Error ? error.name : '';
            if (
              name === 'PermissionError' ||
              message === 'AX_TCC_DENIED' ||
              message.includes('Accessibility is denied')
            ) {
              return describeAxOutcome({ trusted: false, status: -25211, nodeCount: 0 });
            }
            if (message === 'AX_TIMEOUT') {
              return describeAxOutcome({ trusted: true, status: -25204, nodeCount: 0 });
            }
            if (message.startsWith('AX_STATUS_')) {
              return describeAxOutcome({
                trusted: true,
                status: Number(message.slice(10)) || -1,
                nodeCount: 0,
              });
            }
            throw error;
          }
        }
        case 'find':
          return input.backend.axQuery(String(args.target ?? ''), {
            role: typeof args.role === 'string' ? args.role : undefined,
            title: typeof args.title === 'string' ? args.title : undefined,
            value: typeof args.value === 'string' ? args.value : undefined,
            description: typeof args.description === 'string' ? args.description : undefined,
            limit: typeof args.limit === 'number' ? args.limit : undefined,
          });
        case 'ref':
          return input.backend.axNode(String(args.ref ?? ''));
        case 'elementAt':
          return input.backend.axElementAt(Number(args.x), Number(args.y));
        case 'focusedElement':
          return input.backend.axFocused();
        case 'axBounds':
          return (await input.backend.axNode(String(args.ref ?? ''))).bounds ?? null;
        case 'axAttributes':
          return input.backend.axAttributes(String(args.ref ?? ''));
        case 'axActions': {
          const node = await input.backend.axNode(String(args.ref ?? ''));
          return node.actions ?? [];
        }
        case 'axChildren':
          return input.backend.axChildren(String(args.ref ?? ''));
        case 'axParent':
          return input.backend.axParent(String(args.ref ?? ''));
        case 'axPerform':
          await input.backend.axPerform(String(args.ref ?? ''), String(args.action ?? 'press'));
          await settle();
          return { ok: true };
        case 'axSetValue':
          await input.backend.axSetValue(String(args.ref ?? ''), String(args.value ?? ''));
          await settle();
          return { ok: true };
        case 'axFocus':
          await input.backend.axFocus(String(args.ref ?? ''));
          await settle();
          return { ok: true };
        case 'axClick':
          await withSynthetic(() =>
            input.backend.axClick(String(args.ref ?? ''), pointerOpts(args))
          );
          await settle();
          await throwIfProtected();
          return { ok: true };
        case 'clipboard.read':
          return input.backend.clipboardRead();
        case 'clipboard.write':
          await input.backend.clipboardWrite(String(args.text ?? ''));
          return { ok: true };
        case 'wait': {
          const ms = Math.min(Math.max(Number(args.ms) || 0, 0), 60_000);
          if (ms > 0) await abortableDelay(ms, input.signal, sleep);
          return { ok: true };
        }
        default:
          throw new Error(`unknown computer method '${method}'`);
      }
    };

    while (settled === undefined) {
      if (input.signal?.aborted) throw new Error('Computer action aborted');
      vm.executePendingJobs();
      const job = queue.shift();
      if (!job) {
        await Promise.race([finish, new Promise((resolve) => setImmediate(resolve))]);
        continue;
      }
      pause();
      try {
        const payload = await dispatch(job.method, job.args);
        settleJob(job.id, true, jsonClone(payload) ?? null);
        vm.executePendingJobs();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const name = error instanceof Error ? error.name : 'Error';
        settleJob(job.id, false, { message, name });
      } finally {
        resume();
      }
    }

    if (settled instanceof JSException) {
      throw new Error(settled.message);
    }
    if (!settled) throw new Error('computer guest did not settle');
    if ('error' in settled) {
      const message =
        settled.error instanceof JSException
          ? `${settled.error.name}: ${settled.error.message}`
          : String(vm.dump(settled.error));
      settled.error.dispose();
      throw new Error(message);
    }
    const returnValue = jsonClone(vm.dump(settled.value));
    settled.value.dispose();
    resultHandle.dispose();
    if (typeof returnValue === 'string' && returnValue) logs.push(returnValue);
    else if (returnValue !== undefined) logs.push(JSON.stringify(returnValue));
    return {
      text: logs.join('\n'),
      returnValue,
      screenshots,
      capabilities,
    };
  } finally {
    if (!input.persistVm) {
      vm.dispose();
      session.vm = undefined;
      session.primed = false;
      session.host = undefined;
    }
  }
}
