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

const AX_FORCE_EXPAND_ROLES = new Set(['AXOutline', 'AXTable', 'AXList', 'AXMenu']);

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
