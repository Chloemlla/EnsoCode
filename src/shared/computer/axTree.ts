export interface AxTreeNode {
  ref: string;
  role: string;
  title?: string;
  value?: string;
  description?: string;
  enabled?: boolean;
  focused?: boolean;
  actions?: string[];
  children?: AxTreeNode[];
  bounds?: { x: number; y: number; width: number; height: number };
}

function attr(label: string, value: string | undefined): string {
  if (!value) return '';
  return ` ${label}=${JSON.stringify(value)}`;
}

/** 文本树，控件带 [ref=eN]，模型用 win.ref("e5")。 */
export function formatAxTree(nodes: AxTreeNode[], indent = 0): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const node of nodes) {
    const flags = [node.enabled === false ? ' disabled' : '', node.focused ? ' focused' : ''].join(
      ''
    );
    const actions =
      node.actions && node.actions.length > 0 ? ` actions=${node.actions.join(',')}` : '';
    lines.push(
      `${pad}${node.role} [ref=${node.ref}]${attr('title', node.title)}${attr('value', node.value)}${attr('description', node.description)}${flags}${actions}`
    );
    if (node.children?.length) lines.push(formatAxTree(node.children, indent + 1));
  }
  return lines.join('\n');
}
