import type { WinUiaRaw } from './winUia';
import { uiaControlTypeToAxRole, uiaPatternActions } from './winUiaMap';

interface KoffiApi {
  load(path: string): {
    func: (name: string, ret: string, args: unknown[]) => (...args: unknown[]) => unknown;
  };
  proto(convention: string, result: string, args: unknown[]): unknown;
  out(type: unknown): unknown;
  struct(name: string, fields: Record<string, string>): unknown;
  array(ref: string, count: number, hint?: 'Array' | 'Typed'): unknown;
  decode: ((value: unknown, type: unknown) => unknown) & {
    string16(ptr: unknown): string;
  };
  call(ptr: unknown, type: unknown, ...args: unknown[]): unknown;
}

const CLSID_CUIAutomation = 'ff48dba4-60ef-4201-aa87-54103eef594e';
const IID_IUIAutomation = '30cbe57d-d9d0-452a-ab13-7ac5ac4825ee';
const CLSCTX_INPROC_SERVER = 1;
const COINIT_MULTITHREADED = 0;
const TREE_SCOPE_CHILDREN = 2;
const UIA_INVOKE = 10000;
const UIA_VALUE = 10002;
const UIA_EXPAND = 10005;
const UIA_TOGGLE = 10015;
const UIA_BOUNDING_RECTANGLE = 30001;
const VT_ARRAY_R8 = 0x2005;

function guidBytes(guid: string): Buffer {
  const hex = guid.replace(/[{}-]/g, '');
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(Number.parseInt(hex.slice(0, 8), 16), 0);
  buf.writeUInt16LE(Number.parseInt(hex.slice(8, 12), 16), 4);
  buf.writeUInt16LE(Number.parseInt(hex.slice(12, 16), 16), 6);
  for (let i = 0; i < 8; i += 1) {
    buf.writeUInt8(Number.parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16), 8 + i);
  }
  return buf;
}

function failed(hr: unknown): boolean {
  return (Number(hr) | 0) < 0;
}

let cachedRaw: Promise<WinUiaRaw | null> | undefined;

export async function loadWinUiaRaw(): Promise<WinUiaRaw | null> {
  cachedRaw ??= loadWinUiaRawUncached().catch(() => null);
  return cachedRaw;
}

async function loadWinUiaRawUncached(): Promise<WinUiaRaw | null> {
  if (process.platform !== 'win32') return null;
  const koffi = (await import('koffi')).default as unknown as KoffiApi;
  const ole32 = koffi.load('ole32.dll');
  const oleaut = koffi.load('oleaut32.dll');
  const CoInitializeEx = ole32.func('CoInitializeEx', 'long', ['void *', 'uint32']);
  const CoCreateInstance = ole32.func('CoCreateInstance', 'long', [
    'void *',
    'void *',
    'uint32',
    'void *',
    koffi.out('void **'),
  ]);
  const SysFreeString = oleaut.func('SysFreeString', 'void', ['void *']);
  const SysAllocString = oleaut.func('SysAllocString', 'void *', ['str16']);
  const SafeArrayAccessData = oleaut.func('SafeArrayAccessData', 'long', [
    'void *',
    koffi.out('void **'),
  ]);
  const SafeArrayUnaccessData = oleaut.func('SafeArrayUnaccessData', 'long', ['void *']);
  const VariantClear = oleaut.func('VariantClear', 'long', ['void *']);

  const init = Number(CoInitializeEx(null, COINIT_MULTITHREADED));
  // 0 S_OK, 1 S_FALSE already init, 0x80010106 RPC_E_CHANGED_MODE 本线程已是 STA
  if (failed(init) && (init | 0) !== -2147417850) return null;

  const uiaOut: unknown[] = [null];
  const created = Number(
    CoCreateInstance(
      guidBytes(CLSID_CUIAutomation),
      null,
      CLSCTX_INPROC_SERVER,
      guidBytes(IID_IUIAutomation),
      uiaOut
    )
  );
  const uia = uiaOut[0];
  if (failed(created) || !uia) return null;

  const stdcall = (result: string, args: unknown[]) => koffi.proto('__stdcall', result, args);
  const P_Release = stdcall('uint32', ['void *']);
  const P_AddRef = stdcall('uint32', ['void *']);
  const P_GetPtr = stdcall('long', ['void *', koffi.out('void **')]);
  const P_GetInt = stdcall('long', ['void *', koffi.out('int32 *')]);
  const P_FromHandle = stdcall('long', ['void *', 'void *', koffi.out('void **')]);
  const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
  const P_FromPoint = stdcall('long', ['void *', POINT, koffi.out('void **')]);
  const P_FindAll = stdcall('long', ['void *', 'int32', 'void *', koffi.out('void **')]);
  const P_GetElement = stdcall('long', ['void *', 'int32', koffi.out('void **')]);
  const P_GetPattern = stdcall('long', ['void *', 'int32', koffi.out('void **')]);
  const P_Void = stdcall('long', ['void *']);
  const P_SetBstr = stdcall('long', ['void *', 'void *']);
  const P_GetProp = stdcall('long', ['void *', 'int32', 'void *']);

  const slot = (obj: unknown, index: number): unknown => {
    const vtbl = koffi.decode(obj, 'void *');
    const table = koffi.decode(vtbl, koffi.array('void *', index + 1)) as unknown[];
    return table[index];
  };
  const vcall = (obj: unknown, index: number, proto: unknown, ...args: unknown[]) =>
    koffi.call(slot(obj, index), proto, obj, ...args);

  const release = (obj: unknown) => {
    if (obj) vcall(obj, 2, P_Release);
  };
  const retain = (obj: unknown) => {
    if (obj) vcall(obj, 1, P_AddRef);
  };

  const getPtr = (obj: unknown, index: number): unknown | null => {
    const out: unknown[] = [null];
    if (failed(vcall(obj, index, P_GetPtr, out))) return null;
    return out[0] ?? null;
  };

  const getInt = (obj: unknown, index: number): number | undefined => {
    const out = [0];
    if (failed(vcall(obj, index, P_GetInt, out))) return undefined;
    return Number(out[0]);
  };

  const getBstr = (obj: unknown, index: number): string | undefined => {
    const out: unknown[] = [null];
    if (failed(vcall(obj, index, P_GetPtr, out)) || !out[0]) return undefined;
    try {
      const text = koffi.decode.string16(out[0]).replace(/\0+$/g, '').trim();
      return text || undefined;
    } finally {
      SysFreeString(out[0]);
    }
  };

  const getBool = (obj: unknown, index: number): boolean | undefined => {
    const value = getInt(obj, index);
    return value === undefined ? undefined : value !== 0;
  };

  const getBounds = (el: unknown) => {
    const variant = Buffer.alloc(24);
    if (failed(vcall(el, 10, P_GetProp, UIA_BOUNDING_RECTANGLE, variant))) return undefined;
    try {
      if (variant.readUInt16LE(0) !== VT_ARRAY_R8) return undefined;
      const psa = variant.readBigUInt64LE(8);
      if (!psa) return undefined;
      const data: unknown[] = [null];
      if (failed(SafeArrayAccessData(psa, data)) || !data[0]) return undefined;
      try {
        // 按值拷贝：koffi.view 会建外部内存 ArrayBuffer，Electron 的 V8 沙箱不允许，直接 fatal
        const [x, y, width, height] = koffi.decode(
          data[0],
          koffi.array('double', 4, 'Array')
        ) as number[];
        if (![x, y, width, height].every(Number.isFinite)) return undefined;
        return { x, y, width, height };
      } finally {
        SafeArrayUnaccessData(psa);
      }
    } finally {
      VariantClear(variant);
    }
  };

  const pattern = (el: unknown, id: number): unknown | null => {
    const out: unknown[] = [null];
    if (failed(vcall(el, 16, P_GetPattern, id, out)) || !out[0]) return null;
    return out[0];
  };

  const withPattern = (el: unknown, id: number, fn: (p: unknown) => void) => {
    const p = pattern(el, id);
    if (!p) throw new Error('pattern unavailable');
    try {
      fn(p);
    } finally {
      release(p);
    }
  };

  const condition = getPtr(uia, 18) ?? getPtr(uia, 21);
  if (!condition) {
    release(uia);
    return null;
  }

  const childrenOf = (el: unknown): unknown[] => {
    const arrOut: unknown[] = [null];
    if (failed(vcall(el, 6, P_FindAll, TREE_SCOPE_CHILDREN, condition, arrOut)) || !arrOut[0]) {
      return [];
    }
    const arr = arrOut[0];
    try {
      const length = getInt(arr, 3) ?? 0;
      const kids: unknown[] = [];
      for (let i = 0; i < length; i += 1) {
        const childOut: unknown[] = [null];
        if (failed(vcall(arr, 4, P_GetElement, i, childOut)) || !childOut[0]) continue;
        kids.push(childOut[0]);
      }
      return kids;
    } finally {
      release(arr);
    }
  };

  const hasPattern = (el: unknown, id: number): boolean => {
    const p = pattern(el, id);
    if (!p) return false;
    release(p);
    return true;
  };

  const describeInner = (el: unknown, controlType: number) => {
    const password = getBool(el, 35) === true;
    let value: string | undefined;
    if (!password) {
      const vp = pattern(el, UIA_VALUE);
      if (vp) {
        try {
          value = getBstr(vp, 4);
        } finally {
          release(vp);
        }
      }
    }
    return {
      role: uiaControlTypeToAxRole(controlType),
      title: getBstr(el, 23),
      value,
      description: getBstr(el, 31),
      enabled: getBool(el, 28),
      focused: getBool(el, 26),
      actions: uiaPatternActions({
        invoke: hasPattern(el, UIA_INVOKE),
        toggle: hasPattern(el, UIA_TOGGLE),
        expandCollapse: hasPattern(el, UIA_EXPAND),
      }),
      bounds: getBounds(el),
    };
  };

  return {
    elementFromHandle(hwnd) {
      const out: unknown[] = [null];
      if (failed(vcall(uia, 6, P_FromHandle, hwnd, out))) return null;
      return out[0] ?? null;
    },
    elementFromPoint(x, y) {
      const out: unknown[] = [null];
      if (failed(vcall(uia, 7, P_FromPoint, { x, y }, out))) return null;
      return out[0] ?? null;
    },
    focused() {
      return getPtr(uia, 8);
    },
    children: childrenOf,
    describe: (el) => describeInner(el, getInt(el, 21) ?? 0),
    invoke(el) {
      withPattern(el, UIA_INVOKE, (p) => {
        if (failed(vcall(p, 3, P_Void))) throw new Error('invoke failed');
      });
    },
    toggle(el) {
      withPattern(el, UIA_TOGGLE, (p) => {
        if (failed(vcall(p, 3, P_Void))) throw new Error('toggle failed');
      });
    },
    expand(el) {
      withPattern(el, UIA_EXPAND, (p) => {
        if (failed(vcall(p, 3, P_Void))) throw new Error('expand failed');
      });
    },
    collapse(el) {
      withPattern(el, UIA_EXPAND, (p) => {
        if (failed(vcall(p, 4, P_Void))) throw new Error('collapse failed');
      });
    },
    setValue(el, value) {
      withPattern(el, UIA_VALUE, (p) => {
        const bstr = SysAllocString(value);
        if (!bstr) throw new Error('SysAllocString failed');
        try {
          if (failed(vcall(p, 3, P_SetBstr, bstr))) throw new Error('setValue failed');
        } finally {
          SysFreeString(bstr);
        }
      });
    },
    focus(el) {
      if (failed(vcall(el, 3, P_Void))) throw new Error('SetFocus failed');
    },
    retain,
    release,
  };
}
