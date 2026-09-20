import { AxRegistry } from '@shared/computer/axRegistry';
import type { AxTreeNode } from '@shared/computer/axTree';
import type { ComputerCapabilities, ComputerWindowInfo } from '@shared/computer/types';
import type { CaptureBytes, DesktopBackend, PointerOptions } from './backend';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export class FakeDesktopBackend implements DesktopBackend {
  readonly clicks: Array<{ target: string; x: number; y: number; delivery?: string }> = [];
  readonly launches: string[] = [];
  readonly panes: string[] = [];
  clipboard = '';
  private readonly registry = new AxRegistry<AxTreeNode>();
  windowsList: ComputerWindowInfo[] = [
    {
      id: 'w1',
      app: 'Safari',
      title: 'Settings',
      pid: 1,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      focused: true,
    },
  ];

  async capabilities(): Promise<ComputerCapabilities> {
    return {
      platform: 'test',
      capture: true,
      input: true,
      ax: true,
      backgroundInput: true,
      clipboard: true,
      capturePermission: 'granted',
      inputPermission: 'granted',
      axPermission: 'granted',
    };
  }

  async displays() {
    return [{ id: 'd0', x: 0, y: 0, width: 200, height: 100 }];
  }

  async windows() {
    return this.windowsList;
  }

  async capture(target: string): Promise<CaptureBytes> {
    return {
      png: PNG,
      width: 100,
      height: 50,
      sourceWidth: 200,
      sourceHeight: 100,
      originX: 0,
      originY: 0,
      target,
    };
  }

  async click(target: string, screenX: number, screenY: number, opts?: PointerOptions) {
    this.clicks.push({ target, x: screenX, y: screenY, delivery: opts?.delivery });
  }

  async move() {}
  async drag() {}
  async scroll() {}
  async typeText() {}
  async keyChord() {}
  async raise() {}

  async launchApp(name: string, opts?: { pane?: string }) {
    this.launches.push(name);
    if (opts?.pane) this.panes.push(opts.pane);
    if (this.windowsList.length === 0) {
      this.windowsList = [
        {
          id: 'launched',
          app: name,
          title: '',
          pid: 9,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          focused: true,
        },
      ];
    }
  }

  private snapshot(target: string): AxTreeNode[] {
    const generation = this.registry.beginSnapshot(target);
    const button: AxTreeNode = {
      ref: '',
      role: 'button',
      title: 'Save',
      actions: ['press'],
      bounds: { x: 10, y: 10, width: 40, height: 16 },
    };
    button.ref = this.registry.register(target, generation, button);
    const windowNode: AxTreeNode = {
      ref: '',
      role: 'window',
      title: 'Settings',
      children: [button],
    };
    windowNode.ref = this.registry.register(target, generation, windowNode);
    return [windowNode];
  }

  async axSnapshot(target: string) {
    return this.snapshot(target);
  }

  async axQuery(target: string, query: { role?: string; title?: string; limit?: number }) {
    const nodes = flatten(this.snapshot(target));
    return nodes
      .filter(
        (node) =>
          (!query.role || node.role === query.role) &&
          (!query.title || node.title?.includes(query.title))
      )
      .slice(0, query.limit ?? 20);
  }

  async axElementAt() {
    return flatten(this.snapshot('w1'))[1] ?? null;
  }

  async axFocused() {
    return flatten(this.snapshot('w1'))[1] ?? null;
  }

  async axNode(ref: string) {
    return this.registry.resolve(ref);
  }

  async axAttributes() {
    return [['role', 'button']] as Array<[string, string]>;
  }

  async axChildren(ref: string) {
    return this.registry.resolve(ref).children ?? [];
  }

  async axParent() {
    return null;
  }

  async axPerform(ref: string) {
    this.registry.resolve(ref);
  }

  async axSetValue(ref: string) {
    this.registry.resolve(ref);
  }

  async axFocus(ref: string) {
    this.registry.resolve(ref);
  }

  async axClick(ref: string) {
    this.registry.resolve(ref);
  }

  async clipboardRead() {
    return this.clipboard;
  }

  async clipboardWrite(text: string) {
    this.clipboard = text;
  }
}

function flatten(nodes: AxTreeNode[]): AxTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}
