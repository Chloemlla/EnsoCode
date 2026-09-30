import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BackgroundUnavailableError, ComputerError } from '@shared/computer/errors';
import { captureSourceRect, scaleCaptureSize } from '@shared/computer/frame';
import type { ComputerCapabilities, ComputerWindowInfo } from '@shared/computer/types';
import {
  clipboard,
  desktopCapturer,
  type NativeImage,
  type Rectangle,
  screen,
  shell,
} from 'electron';
import type { CaptureBytes, DesktopBackend, PointerOptions } from './backend';
import { loadWin32Native, type Win32Native } from './win32Native';
import { findCapturerWindowSource, thumbnailCropForWindow } from './windowSource';
import { resolveWinLaunch, resolveWinSettingsPane } from './winLaunch';

const execFileAsync = promisify(execFile);

// 窗口矩形与 SendInput 都是物理像素；Electron 的 display 是 DIP，统一换成物理像素
const toPhysical = (rect: Rectangle): Rectangle => screen.dipToScreenRect(null, rect);
const primaryPhysical = () => toPhysical(screen.getPrimaryDisplay().bounds);

export class WindowsDesktopBackend implements DesktopBackend {
  private native: Win32Native | null | undefined;

  private async nativeOrNull(): Promise<Win32Native | null> {
    if (this.native !== undefined) return this.native;
    this.native = await loadWin32Native();
    return this.native;
  }

  private async requireNative(): Promise<Win32Native> {
    const native = await this.nativeOrNull();
    if (!native) {
      throw new ComputerError('unsupported', 'Native desktop bridge is unavailable');
    }
    return native;
  }

  async capabilities(): Promise<ComputerCapabilities> {
    const native = await this.nativeOrNull();
    return {
      platform: 'win32',
      capture: true,
      input: Boolean(native),
      ax: false,
      backgroundInput: false,
      clipboard: true,
      capturePermission: 'granted',
      inputPermission: native ? 'granted' : 'unsupported',
      axPermission: 'unsupported',
      detail: native
        ? 'Windows input uses SendInput and brings the target window to the front. No accessibility tree yet: work from screenshots and click(x, y). cmd in shortcuts means Ctrl.'
        : 'Native input bridge unavailable.',
    };
  }

  async displays() {
    return screen.getAllDisplays().map((display) => {
      const bounds = toPhysical(display.bounds);
      return {
        id: String(display.id),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        scaleFactor: display.scaleFactor,
      };
    });
  }

  async windows(): Promise<ComputerWindowInfo[]> {
    const native = await this.nativeOrNull();
    if (native) return native.windows();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
    });
    return sources.map((source) => ({
      id: source.id,
      app: source.name,
      title: source.name,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }));
  }

  async capture(target: string, maxWidth: number, maxHeight: number): Promise<CaptureBytes> {
    const types = target === 'desktop' ? (['screen'] as const) : (['window'] as const);
    const sources = await desktopCapturer.getSources({
      types: [...types],
      thumbnailSize: { width: maxWidth, height: maxHeight },
    });
    if (target === 'desktop') {
      const primaryId = String(screen.getPrimaryDisplay().id);
      const source = sources.find((item) => item.display_id === primaryId) ?? sources[0];
      if (!source) throw new ComputerError('window-not-found', `window '${target}' not found`);
      return this.captureFromImage(source.thumbnail, target, maxWidth, maxHeight);
    }
    const source = findCapturerWindowSource(sources, target);
    if (source) return this.captureFromImage(source.thumbnail, target, maxWidth, maxHeight);
    return this.captureWindowViaDisplay(target, maxWidth, maxHeight);
  }

  private async captureFromImage(
    image: NativeImage,
    target: string,
    maxWidth: number,
    maxHeight: number,
    windowInfo?: ComputerWindowInfo
  ): Promise<CaptureBytes> {
    const size = image.getSize();
    const png = image.toPNG();
    const info = windowInfo ?? (await this.windows()).find((window) => window.id === target);
    const scaled = scaleCaptureSize(size.width, size.height, maxWidth, maxHeight);
    const display = primaryPhysical();
    const rect = captureSourceRect({
      target,
      thumbnailWidth: size.width,
      thumbnailHeight: size.height,
      window: info,
      display: { x: display.x, y: display.y, width: display.width, height: display.height },
    });
    return {
      png,
      width: scaled.width,
      height: scaled.height,
      sourceWidth: rect.sourceWidth,
      sourceHeight: rect.sourceHeight,
      originX: rect.originX,
      originY: rect.originY,
      target,
    };
  }

  private async captureWindowViaDisplay(
    target: string,
    maxWidth: number,
    maxHeight: number
  ): Promise<CaptureBytes> {
    const info = (await this.windows()).find((window) => window.id === target);
    if (!info) throw new ComputerError('window-not-found', `window '${target}' not found`);
    const display = screen.getDisplayMatching(
      screen.screenToDipRect(null, {
        x: Math.round(info.x),
        y: Math.round(info.y),
        width: Math.max(1, Math.round(info.width)),
        height: Math.max(1, Math.round(info.height)),
      })
    );
    const bounds = toPhysical(display.bounds);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: bounds.width, height: bounds.height },
    });
    const screenSource = sources.find((item) => item.display_id === String(display.id));
    if (!screenSource) throw new ComputerError('window-not-found', `window '${target}' not found`);
    const thumb = screenSource.thumbnail.getSize();
    const crop = thumbnailCropForWindow({
      window: info,
      display: bounds,
      thumbnailWidth: thumb.width,
      thumbnailHeight: thumb.height,
    });
    if (!crop) throw new ComputerError('window-not-found', `window '${target}' not found`);
    return this.captureFromImage(
      screenSource.thumbnail.crop(crop),
      target,
      maxWidth,
      maxHeight,
      info
    );
  }

  async click(_target: string, screenX: number, screenY: number, opts?: PointerOptions) {
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError(
        'Windows pixel click cannot target a window in background'
      );
    }
    await (await this.requireNative()).click(screenX, screenY, {
      button: opts?.button,
      count: opts?.count,
      modifiers: opts?.modifiers,
    });
  }

  async move(_target: string, screenX: number, screenY: number, opts?: PointerOptions) {
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('Windows mouse move cannot run in background');
    }
    await (await this.requireNative()).move(screenX, screenY);
  }

  async drag(target: string, points: Array<{ x: number; y: number }>, opts?: PointerOptions) {
    if (points.length === 0) return;
    await this.move(target, points[0].x, points[0].y, opts);
    await (await this.requireNative()).drag(points);
  }

  async scroll(
    _target: string,
    screenX: number,
    screenY: number,
    dx: number,
    dy: number,
    opts?: PointerOptions
  ) {
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('Windows scroll cannot run in background');
    }
    await (await this.requireNative()).scroll(screenX, screenY, dx, dy);
  }

  async typeText(_target: string, text: string, opts?: PointerOptions) {
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('Windows typing cannot run in background');
    }
    await (await this.requireNative()).typeText(text);
  }

  async keyChord(_target: string, keys: string[], opts?: PointerOptions) {
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('Windows key chords cannot run in background');
    }
    await (await this.requireNative()).keyChord(keys);
  }

  async raise(windowId: string) {
    await (await this.requireNative()).raise(windowId);
  }

  async endRun() {
    this.native?.endInput();
  }

  async launchApp(name: string, opts?: { pane?: string }) {
    const pane = opts?.pane ? resolveWinSettingsPane(opts.pane) : undefined;
    if (pane) {
      await shell.openExternal(pane);
      return;
    }
    const launch = resolveWinLaunch(name);
    if (!launch.app) {
      await shell.openExternal(launch.target);
      return;
    }
    await execFileAsync('cmd.exe', ['/c', 'start', '', launch.target], { windowsHide: true });
  }

  async axSnapshot(): Promise<never[]> {
    return [];
  }
  async axQuery(): Promise<never[]> {
    return [];
  }
  async axElementAt() {
    return null;
  }
  async axFocused() {
    return null;
  }
  async axNode(): Promise<never> {
    throw new ComputerError('unsupported', 'Accessibility is not available on Windows yet');
  }
  async axAttributes(): Promise<never> {
    return this.axNode();
  }
  async axChildren(): Promise<never> {
    return this.axNode();
  }
  async axParent() {
    return null;
  }
  async axPerform(): Promise<never> {
    return this.axNode();
  }
  async axSetValue(): Promise<never> {
    return this.axNode();
  }
  async axFocus(): Promise<never> {
    return this.axNode();
  }
  async axClick(): Promise<never> {
    return this.axNode();
  }

  async clipboardRead() {
    return clipboard.readText();
  }

  async clipboardWrite(text: string) {
    clipboard.writeText(text);
  }
}
