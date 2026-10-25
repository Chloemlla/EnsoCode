import { openFrame, sealFrame, toBase64Url } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TestSocket {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const hostMocks = vi.hoisted(() => ({
  socket: null as TestSocket | null,
  loadDevices: vi.fn(),
}));

vi.mock('@enso/pair', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@enso/pair')>()),
  attachHeartbeat: () => ({ stop: vi.fn(), probe: vi.fn() }),
}));
vi.mock('electron', () => ({
  app: { getVersion: () => 'test' },
  powerMonitor: { on: vi.fn() },
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
}));
vi.mock('./agentHost', () => ({
  requestSnapshot: vi.fn(),
  setPinnedSessions: vi.fn(),
}));
vi.mock('./macosSystemSleepAssertion', () => ({
  MacosSystemSleepAssertion: class {
    start(): void {}
    stop(): void {}
  },
}));
vi.mock('./notifications', () => ({ readNotifyMainAgentOnly: () => false }));
vi.mock('./pairDirectConfig', () => ({ PAIR_DIRECT_ENABLED: false, PAIR_STUN_SERVERS: [] }));
vi.mock('./pairDirectPeer', () => ({
  isDirectPeerAvailable: () => false,
  mainDirectPeerFactory: null,
  preloadDirectPeer: () => Promise.resolve(),
}));
vi.mock('./pairNetworkWatch', () => ({ startPairNetworkWatch: () => vi.fn() }));
vi.mock('./pairRelayLookup', () => ({ seedRelayHostCache: vi.fn() }));
vi.mock('./pairRelayOpen', () => ({
  openPairRelayWebSocket: () => Promise.resolve(hostMocks.socket),
}));
vi.mock('./pairStore', () => ({
  isSecureStorageAvailable: () => true,
  loadDevices: hostMocks.loadDevices,
  loadRelayHostCache: () => null,
  loadRelayUrl: () => null,
  renameDevice: (devices: unknown) => devices,
  saveDevices: vi.fn(),
  saveRelayUrl: vi.fn(),
  upsertDevice: (devices: unknown) => devices,
}));
vi.mock('./pushNotifier', () => ({
  buildPushPayload: () => null,
  clearPushSubscription: vi.fn(),
  getVapidPublicKey: () => '',
  hasPushSubscription: () => false,
  sendPush: vi.fn(),
  setPushSubscription: vi.fn(),
}));

import { startPairHost, stopPairHost, updatePairCatalog } from './pairHost';
import { type RemoteLink, setRemoteHostHooks } from './remoteRenderer/hostHooks';

describe('pairHost 目录下发', () => {
  const contentKey = new Uint8Array(32).fill(7);

  beforeEach(async () => {
    hostMocks.socket = {
      readyState: 1,
      binaryType: '',
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(),
    };
    hostMocks.loadDevices.mockReturnValue([
      {
        pairId: 'pair-1',
        token: 'token-1',
        contentKey: toBase64Url(contentKey),
        deviceName: 'guest-desktop',
        relayUrl: 'https://relay.example.com',
        pairedAt: 1,
      },
    ]);
    startPairHost();
    await vi.waitFor(() => expect(hostMocks.socket?.onmessage).toBeTypeOf('function'));
    hostMocks.socket?.onopen?.();
  });

  afterEach(() => {
    stopPairHost();
  });

  const control = (type: 'peer-joined' | 'peer-left'): void => {
    hostMocks.socket?.onmessage?.({ data: JSON.stringify({ type }) });
  };

  async function sentPayloads(): Promise<Record<string, unknown>[]> {
    const calls = hostMocks.socket?.send.mock.calls ?? [];
    return Promise.all(
      calls.map(
        async ([data]) =>
          (await openFrame(contentKey, new Uint8Array(data))) as Record<string, unknown>
      )
    );
  }

  async function sentTypes(): Promise<unknown[]> {
    return (await sentPayloads()).map((payload) => payload.type);
  }

  it('对端刷新后重新进房，模型表必须重发（内存已空，不能按上次进房的指纹跳过）', async () => {
    control('peer-joined');
    const providers = [{ id: 'p1', name: 'Provider', models: [{ id: 'm1', label: 'Model' }] }];
    updatePairCatalog({
      catalog: [],
      projects: [{ id: 'proj-1', name: 'demo', path: '/tmp/demo' }],
      providers,
      projectPaths: [{ id: 'proj-1', path: '/tmp/demo' }],
      theme: 'dark',
    });
    await vi.waitFor(async () => expect(await sentTypes()).toContain('appearance'));
    expect(await sentTypes()).toContain('providers');
    await new Promise((resolve) => setTimeout(resolve, 20));

    hostMocks.socket?.send.mockClear();
    control('peer-left');
    control('peer-joined');

    await vi.waitFor(async () => expect(await sentTypes()).toContain('host-info'));
    expect(await sentTypes()).toContain('projects');
    expect((await sentPayloads()).find((payload) => payload.type === 'providers')).toMatchObject({
      providers,
    });
  });

  it('host-info 向可操作设备声明桌面模式能力', async () => {
    control('peer-joined');
    await vi.waitFor(async () => expect(await sentTypes()).toContain('host-info'));
    // 可操作设备才声明桌面模式；旧桌面缺省该字段，PWA 据此隐藏入口
    expect((await sentPayloads()).find((payload) => payload.type === 'host-info')).toMatchObject({
      remoteDesktop: true,
    });
  });

  it('同一次进房内对端再要目录，不重打模型表', async () => {
    control('peer-joined');
    updatePairCatalog({
      catalog: [],
      projects: [],
      providers: [{ id: 'p1', name: 'Provider', models: [{ id: 'm1' }] }],
      projectPaths: [],
      theme: 'dark',
    });
    await vi.waitFor(async () => expect(await sentTypes()).toContain('providers'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    hostMocks.socket?.send.mockClear();
    const frame = await sealFrame(contentKey, { type: 'snapshot' });
    hostMocks.socket?.onmessage?.({
      data: frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength
      ) as ArrayBuffer,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await sentTypes()).not.toContain('providers');
  });

  it('手机已离开且无直连时，远程桌面帧不再发往中继，改为挂起远端 renderer', async () => {
    const links: RemoteLink[] = [];
    const linkDown = vi.fn();
    setRemoteHostHooks({
      command: async (link) => {
        links.push(link);
      },
      linkDown,
      linkRevoked: vi.fn(),
    });
    control('peer-joined');
    const frame = await sealFrame(contentKey, { type: 'rpc-hello', cid: 'c1', kind: 'main' });
    hostMocks.socket?.onmessage?.({
      data: frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength
      ) as ArrayBuffer,
    });
    await vi.waitFor(() => expect(links).toHaveLength(1));
    const link = links[0] as RemoteLink;
    await new Promise((resolve) => setTimeout(resolve, 20));

    hostMocks.socket?.send.mockClear();
    link.send({ type: 'rpc-event', cid: 'c1', ch: 'x', args: [], seq: 1 } as never);
    await vi.waitFor(async () => expect(await sentTypes()).toContain('rpc-event'));

    control('peer-left');
    linkDown.mockClear();
    hostMocks.socket?.send.mockClear();
    link.send({ type: 'rpc-event', cid: 'c1', ch: 'x', args: [], seq: 2 } as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 发给中继也没人收：帧已在 RemoteSender 保留窗口里，挂起后等手机续上再补
    expect(await sentTypes()).not.toContain('rpc-event');
    expect(linkDown).toHaveBeenCalledWith('pair-1');
  });
});
