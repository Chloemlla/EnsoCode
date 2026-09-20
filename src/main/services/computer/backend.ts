import type { AxTreeNode } from '@shared/computer/axTree';
import type {
  ComputerCapabilities,
  ComputerDisplayInfo,
  ComputerWindowInfo,
} from '@shared/computer/types';

export interface PointerOptions {
  button?: string;
  count?: number;
  modifiers?: string[];
  delivery?: 'background' | 'foreground';
}

export interface CaptureBytes {
  png: Buffer;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  originX: number;
  originY: number;
  target: string;
}

export interface DesktopBackend {
  capabilities(): Promise<ComputerCapabilities>;
  displays(): Promise<ComputerDisplayInfo[]>;
  windows(): Promise<ComputerWindowInfo[]>;
  capture(target: string, maxWidth: number, maxHeight: number): Promise<CaptureBytes>;
  click(target: string, screenX: number, screenY: number, opts?: PointerOptions): Promise<void>;
  move(target: string, screenX: number, screenY: number, opts?: PointerOptions): Promise<void>;
  drag(
    target: string,
    points: Array<{ x: number; y: number }>,
    opts?: PointerOptions
  ): Promise<void>;
  scroll(
    target: string,
    screenX: number,
    screenY: number,
    dx: number,
    dy: number,
    opts?: PointerOptions
  ): Promise<void>;
  typeText(target: string, text: string, opts?: PointerOptions): Promise<void>;
  keyChord(target: string, keys: string[], opts?: PointerOptions): Promise<void>;
  raise(windowId: string): Promise<void>;
  launchApp(name: string, opts?: { pane?: string }): Promise<void>;
  axSnapshot(target: string, opts?: { maxDepth?: number; all?: boolean }): Promise<AxTreeNode[]>;
  axQuery(
    target: string,
    query: { role?: string; title?: string; value?: string; limit?: number }
  ): Promise<AxTreeNode[]>;
  axElementAt(screenX: number, screenY: number): Promise<AxTreeNode | null>;
  axFocused(): Promise<AxTreeNode | null>;
  axNode(ref: string): Promise<AxTreeNode>;
  axAttributes(ref: string): Promise<Array<[string, string]>>;
  axChildren(ref: string): Promise<AxTreeNode[]>;
  axParent(ref: string): Promise<AxTreeNode | null>;
  axPerform(ref: string, action: string): Promise<void>;
  axSetValue(ref: string, value: string): Promise<void>;
  axFocus(ref: string): Promise<void>;
  axClick(ref: string, opts?: PointerOptions): Promise<void>;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
}
