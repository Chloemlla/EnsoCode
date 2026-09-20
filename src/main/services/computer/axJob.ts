import type { AxTreeNode } from '@shared/computer/axTree';
import type { AxWorkerRequest } from './axWorkerClient';

export type AxJobBridge = {
  snapshot(pid: number, maxDepth: number): Promise<AxTreeNode[]>;
  elementAt(x: number, y: number): Promise<AxTreeNode | null>;
  focused(): Promise<AxTreeNode | null>;
  node(handle: string): Promise<AxTreeNode>;
  attributes(handle: string): Promise<Array<[string, string]>>;
  children(handle: string): Promise<AxTreeNode[]>;
  perform(handle: string, action: string): Promise<void>;
  setValue(handle: string, value: string): Promise<void>;
  focus(handle: string): Promise<void>;
};

export async function dispatchAxJob(ax: AxJobBridge, request: AxWorkerRequest): Promise<unknown> {
  switch (request.op) {
    case 'snapshot':
      return ax.snapshot(request.pid, request.maxDepth);
    case 'elementAt':
      return ax.elementAt(request.x, request.y);
    case 'focused':
      return ax.focused();
    case 'node':
      return ax.node(request.handle);
    case 'attributes':
      return ax.attributes(request.handle);
    case 'children':
      return ax.children(request.handle);
    case 'perform':
      return ax.perform(request.handle, request.action);
    case 'setValue':
      return ax.setValue(request.handle, request.value);
    case 'focus':
      return ax.focus(request.handle);
  }
}

export function isAxPressUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bfailed \(-25206\)/.test(message);
}
