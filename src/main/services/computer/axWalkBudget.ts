export const AX_SNAPSHOT_BUDGET_MS = 2500;
export const AX_SNAPSHOT_MAX_NODES = 80;
export const AX_SNAPSHOT_DEFAULT_DEPTH = 1;
export const AX_SNAPSHOT_MAX_CHILDREN = 24;
export const AX_MESSAGING_TIMEOUT_SEC = 0.4;

export function axWalkDecision(input: {
  startedAt: number;
  nodeCount: number;
  now?: number;
}): 'continue' | 'timeout' | 'budget' {
  if ((input.now ?? Date.now()) - input.startedAt >= AX_SNAPSHOT_BUDGET_MS) return 'timeout';
  if (input.nodeCount >= AX_SNAPSHOT_MAX_NODES) return 'budget';
  return 'continue';
}

const AX_PASSTHROUGH_ROLES = new Set([
  'AXGroup',
  'AXSplitGroup',
  'AXScrollArea',
  'AXLayoutArea',
  'AXGenericElement',
  'AXSheet',
  'AXDialog',
]);

const AX_FORCE_EXPAND_ROLES = new Set([
  'AXOutline',
  'AXTable',
  'AXList',
  'AXMenu',
  'AXPopUpButton',
  'AXMenuButton',
]);

export function axNextDepth(role: string, depth: number): number {
  return AX_PASSTHROUGH_ROLES.has(role) ? depth : depth + 1;
}

export function axShouldExpand(role: string, depth: number, maxDepth: number): boolean {
  if (AX_PASSTHROUGH_ROLES.has(role) || AX_FORCE_EXPAND_ROLES.has(role)) return true;
  return depth < maxDepth;
}

export function axRowTitleFromCells(
  title: string | undefined,
  value: string | undefined,
  cells: string[]
): string | undefined {
  if (title || value) return undefined;
  const text = cells
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(' ');
  return text || undefined;
}

export function axCollectVisibleText(node: {
  title?: string;
  value?: string;
  description?: string;
  children?: Array<{
    title?: string;
    value?: string;
    description?: string;
    children?: unknown[];
  }>;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (item: typeof node, depth: number) => {
    if (depth > 4) return;
    for (const part of [item.title, item.value, item.description]) {
      const text = part?.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    for (const child of item.children ?? []) walk(child as typeof node, depth + 1);
  };
  walk(node, 0);
  return out;
}

export function axFillEmptyRowTitle(node: {
  role?: string;
  title?: string;
  value?: string;
  description?: string;
  children?: Array<{
    title?: string;
    value?: string;
    description?: string;
    children?: unknown[];
  }>;
}): void {
  if (node.role !== 'AXRow' && node.role !== 'AXCell') return;
  if (node.title || node.value) return;
  const text = axCollectVisibleText(node).join(' ');
  if (text) node.title = text;
}
