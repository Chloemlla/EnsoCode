/**
 * JSON 值的增量：远端桌面经中继同步大对象（settings、流式消息）时只传变化的叶子。
 * 带 `$enso` 标签的对象是 remote 编解码的特殊值，整体替换不深入，保证编码态与解码态上应用结果一致。
 */
export type JsonPath = (string | number)[];
export type JsonOp =
  | ['s', JsonPath, unknown]
  | ['d', JsonPath]
  | ['a', JsonPath, string]
  | ['t', JsonPath, number];

const APPEND_MIN_CHARS = 32;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const isPlain = (v: unknown): v is Record<string, unknown> => isRecord(v) && !('$enso' in v);

function sameLeaf(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function walk(a: unknown, b: unknown, path: JsonPath, ops: JsonOp[]): void {
  if (a === b) return;
  if (isPlain(a) && isPlain(b)) {
    for (const key of Object.keys(a)) if (!(key in b)) ops.push(['d', [...path, key]]);
    for (const [key, value] of Object.entries(b)) {
      if (key in a) walk(a[key], value, [...path, key], ops);
      else ops.push(['s', [...path, key], value]);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (b.length < a.length) ops.push(['t', path, b.length]);
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) walk(a[i], b[i], [...path, i], ops);
    for (let i = common; i < b.length; i++) ops.push(['s', [...path, i], b[i]]);
    return;
  }
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.length >= APPEND_MIN_CHARS &&
    b.length > a.length &&
    b.startsWith(a)
  ) {
    ops.push(['a', path, b.slice(a.length)]);
    return;
  }
  if (!sameLeaf(a, b)) ops.push(['s', path, b]);
}

export function diffJson(prev: unknown, next: unknown): JsonOp[] {
  const ops: JsonOp[] = [];
  walk(prev, next, [], ops);
  return ops;
}

function checkKey(container: unknown, key: string | number): void {
  if (Array.isArray(container)) {
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key > container.length) {
      throw new Error('json delta: bad index');
    }
  } else if (!isRecord(container) || typeof key !== 'string' || key === '__proto__') {
    throw new Error('json delta: bad key');
  }
}

/** 不修改 base：沿路径复制容器（同一批操作内已复制的容器复用） */
export function applyJsonDelta(base: unknown, ops: readonly JsonOp[]): unknown {
  const copied = new WeakSet<object>();
  const own = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null || copied.has(value)) return value;
    const copy = Array.isArray(value) ? [...value] : { ...(value as Record<string, unknown>) };
    copied.add(copy);
    return copy;
  };
  let root = base;
  for (const op of ops) {
    const path = op[1];
    if (!Array.isArray(path)) throw new Error('json delta: bad path');
    if (path.length === 0) {
      if (op[0] === 's') root = op[2];
      else if (op[0] === 'a' && typeof root === 'string') root = root + op[2];
      else if (op[0] === 't' && Array.isArray(root)) {
        root = root.slice(0, op[2]);
        copied.add(root as unknown[]);
      } else throw new Error('json delta: bad root op');
      continue;
    }
    root = own(root);
    let parent = root as Record<string | number, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
      checkKey(parent, path[i]);
      const child = own(parent[path[i]]);
      if (typeof child !== 'object' || child === null) throw new Error('json delta: bad path');
      parent[path[i]] = child;
      parent = child as Record<string | number, unknown>;
    }
    const key = path[path.length - 1];
    checkKey(parent, key);
    switch (op[0]) {
      case 's':
        parent[key] = op[2];
        break;
      case 'd':
        if (Array.isArray(parent)) throw new Error('json delta: bad delete');
        delete parent[key];
        break;
      case 'a':
        if (typeof parent[key] !== 'string') throw new Error('json delta: bad append');
        parent[key] = (parent[key] as string) + op[2];
        break;
      case 't': {
        const arr = parent[key];
        if (!Array.isArray(arr)) throw new Error('json delta: bad truncate');
        const copy = arr.slice(0, op[2]);
        copied.add(copy);
        parent[key] = copy;
        break;
      }
      default:
        throw new Error('json delta: bad op');
    }
  }
  return root;
}

/** 增量明显小于整份时才值得发（编码后字符数比较） */
export function worthDelta(ops: readonly JsonOp[], next: unknown, ratio = 0.5): boolean {
  return JSON.stringify(ops).length < JSON.stringify(next ?? null).length * ratio;
}
