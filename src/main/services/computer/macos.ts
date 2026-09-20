import { AxRegistry } from '@shared/computer/axRegistry';
import type { AxTreeNode } from '@shared/computer/axTree';
import {
  BackgroundUnavailableError,
  ComputerError,
  PermissionError,
} from '@shared/computer/errors';
import { captureSourceRect, scaleCaptureSize } from '@shared/computer/frame';
import type {
  ComputerCapabilities,
  ComputerPermissionState,
  ComputerWindowInfo,
} from '@shared/computer/types';
import { clipboard, desktopCapturer, type NativeImage, screen, systemPreferences } from 'electron';
import { isAxPressUnsupported } from './axJob';
import { AX_SNAPSHOT_BUDGET_MS, AX_SNAPSHOT_DEFAULT_DEPTH } from './axWalkBudget';
import type { CaptureBytes, DesktopBackend, PointerOptions } from './backend';
import { loadMacosNative, type MacosNative } from './macosNative';
import { preflightScreenCaptureAccess } from './screenCaptureAccess';
import { findCapturerWindowSource, thumbnailCropForWindow } from './windowSource';

async function capturePermission(): Promise<ComputerPermissionState> {
  if (await preflightScreenCaptureAccess()) return 'granted';
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return 'granted';
  if (status === 'denied' || status === 'restricted') return 'denied';
  return 'unknown';
}

function axPermission(): ComputerPermissionState {
  return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied';
}

export class MacosDesktopBackend implements DesktopBackend {
  private native: MacosNative | null | undefined;
  private readonly registry = new AxRegistry<string>();

  private async nativeOrNull(): Promise<MacosNative | null> {
    if (this.native !== undefined) return this.native;
    this.native = await loadMacosNative();
    return this.native;
  }

  async capabilities(): Promise<ComputerCapabilities> {
    const native = await this.nativeOrNull();
    const capture = await capturePermission();
    const ax = axPermission();
    return {
      platform: 'darwin',
      capture: capture !== 'denied',
      input: Boolean(native) && ax === 'granted',
      ax: Boolean(native) && ax === 'granted',
      backgroundInput: Boolean(native) && ax === 'granted',
      clipboard: true,
      capturePermission: capture,
      inputPermission: ax,
      axPermission: ax,
      detail:
        capture === 'denied' || ax === 'denied'
          ? 'Grant Screen Recording and Accessibility to EnsoCode, then restart the app.'
          : native
            ? undefined
            : 'Native desktop bridge unavailable; screenshots still work.',
    };
  }

  async displays() {
    return screen.getAllDisplays().map((display) => ({
      id: String(display.id),
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      scaleFactor: display.scaleFactor,
    }));
  }

  async windows(): Promise<ComputerWindowInfo[]> {
    const native = await this.nativeOrNull();
    if (native) return native.windows();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
    });
    return sources.map((source) => {
      const name = source.name;
      const split = name.indexOf(' - ');
      return {
        id: source.id,
        app: split > 0 ? name.slice(0, split) : name,
        title: split > 0 ? name.slice(split + 3) : name,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
    });
  }

  async capture(target: string, maxWidth: number, maxHeight: number): Promise<CaptureBytes> {
    if ((await capturePermission()) === 'denied') {
      throw new PermissionError(
        'capture',
        'Screen Recording is denied. Enable it for EnsoCode in System Settings.'
      );
    }
    const types = target === 'desktop' ? (['screen'] as const) : (['window'] as const);
    const sources = await desktopCapturer.getSources({
      types: [...types],
      thumbnailSize: { width: maxWidth, height: maxHeight },
    });
    if (target === 'desktop') {
      const source = sources[0];
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
    const info =
      windowInfo ??
      (await this.windows()).find((window) => window.id === target || target.includes(window.id));
    const scaled = scaleCaptureSize(size.width, size.height, maxWidth, maxHeight);
    const display = screen.getPrimaryDisplay().bounds;
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
    const display = screen.getDisplayMatching({
      x: Math.round(info.x),
      y: Math.round(info.y),
      width: Math.max(1, Math.round(info.width)),
      height: Math.max(1, Math.round(info.height)),
    });
    const bounds = display.bounds;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: bounds.width, height: bounds.height },
    });
    const screenSource =
      sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
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

  private async requireNative(kind: 'input' | 'ax'): Promise<MacosNative> {
    if (axPermission() !== 'granted') {
      throw new PermissionError(
        kind,
        'Accessibility is denied. Enable it for EnsoCode in System Settings, then restart.'
      );
    }
    const native = await this.nativeOrNull();
    if (!native) {
      throw new ComputerError('unsupported', 'Native desktop bridge is unavailable');
    }
    return native;
  }

  async click(_target: string, screenX: number, screenY: number, opts?: PointerOptions) {
    const native = await this.requireNative('input');
    const delivery = opts?.delivery ?? 'background';
    if (delivery === 'background') {
      throw new BackgroundUnavailableError(
        'macOS pixel click cannot target a window in background'
      );
    }
    await native.click(screenX, screenY, opts);
  }

  async move(_target: string, screenX: number, screenY: number, opts?: PointerOptions) {
    const native = await this.requireNative('input');
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('macOS mouse move cannot run in background');
    }
    await native.move(screenX, screenY);
  }

  async drag(target: string, points: Array<{ x: number; y: number }>, opts?: PointerOptions) {
    if (points.length === 0) return;
    await this.move(target, points[0].x, points[0].y, opts);
    const native = await this.requireNative('input');
    await native.drag(points);
  }

  async scroll(
    _target: string,
    screenX: number,
    screenY: number,
    dx: number,
    dy: number,
    opts?: PointerOptions
  ) {
    const native = await this.requireNative('input');
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('macOS scroll cannot run in background');
    }
    await native.scroll(screenX, screenY, dx, dy);
  }

  async typeText(_target: string, text: string, opts?: PointerOptions) {
    const native = await this.requireNative('input');
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('macOS typing cannot run in background without AX');
    }
    await native.typeText(text);
  }

  async keyChord(_target: string, keys: string[], opts?: PointerOptions) {
    const native = await this.requireNative('input');
    if ((opts?.delivery ?? 'background') === 'background') {
      throw new BackgroundUnavailableError('macOS key chords cannot run in background without AX');
    }
    await native.keyChord(keys);
  }

  async raise(windowId: string) {
    const native = await this.requireNative('input');
    await native.raise(windowId);
  }

  async axSnapshot(target: string, opts?: { maxDepth?: number; all?: boolean }) {
    const native = await this.requireNative('ax');
    const generation = this.registry.beginSnapshot(target);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nodes = await Promise.race([
      native.axSnapshot(target, opts?.maxDepth ?? (opts?.all ? 8 : AX_SNAPSHOT_DEFAULT_DEPTH)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AX_TIMEOUT')), AX_SNAPSHOT_BUDGET_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    const attach = (node: AxTreeNode): AxTreeNode => {
      const ref = this.registry.register(target, generation, node.ref);
      return {
        ...node,
        ref,
        children: node.children?.map(attach),
      };
    };
    return nodes.map(attach);
  }

  async axQuery(
    target: string,
    query: { role?: string; title?: string; value?: string; limit?: number }
  ) {
    const nodes = flatten(await this.axSnapshot(target));
    return nodes
      .filter(
        (node) =>
          (!query.role || node.role === query.role) &&
          (!query.title ||
            node.title?.toLocaleLowerCase().includes(query.title.toLocaleLowerCase())) &&
          (!query.value || node.value?.includes(query.value))
      )
      .slice(0, query.limit ?? 20);
  }

  async axElementAt(screenX: number, screenY: number) {
    const native = await this.requireNative('ax');
    return native.axElementAt(screenX, screenY);
  }

  async axFocused() {
    const native = await this.requireNative('ax');
    return native.axFocused();
  }

  async axNode(ref: string) {
    const handle = this.registry.resolve(ref);
    const native = await this.requireNative('ax');
    return { ...(await native.axNode(handle)), ref };
  }

  async axAttributes(ref: string) {
    const native = await this.requireNative('ax');
    return native.axAttributes(this.registry.resolve(ref));
  }

  async axChildren(ref: string) {
    const native = await this.requireNative('ax');
    const children = await native.axChildren(this.registry.resolve(ref));
    return children.map((child) => ({
      ...child,
      ref: this.registry.adopt(ref, child.ref),
    }));
  }

  async axParent(ref: string) {
    const native = await this.requireNative('ax');
    return native.axParent(this.registry.resolve(ref));
  }

  async axPerform(ref: string, action: string) {
    const native = await this.requireNative('ax');
    await native.axPerform(this.registry.resolve(ref), action);
  }

  async axSetValue(ref: string, value: string) {
    const native = await this.requireNative('ax');
    await native.axSetValue(this.registry.resolve(ref), value);
  }

  async axFocus(ref: string) {
    const native = await this.requireNative('ax');
    await native.axFocus(this.registry.resolve(ref));
  }

  async axClick(ref: string) {
    try {
      await this.axPerform(ref, 'press');
    } catch (error) {
      if (!isAxPressUnsupported(error)) throw error;
      const bounds = (await this.axNode(ref)).bounds;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw error;
      await this.click(
        this.registry.targetOf(ref),
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        { delivery: 'foreground' }
      );
    }
  }

  async clipboardRead() {
    return clipboard.readText();
  }

  async clipboardWrite(text: string) {
    clipboard.writeText(text);
  }
}

function flatten(nodes: AxTreeNode[]): AxTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}
