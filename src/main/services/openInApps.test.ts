import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  getFileIcon: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile, spawn: mocks.spawn }));
vi.mock('electron', () => ({ app: { getFileIcon: mocks.getFileIcon } }));

import { buildLaunchArgs, createOpenInApps } from './openInApps';

type ExecCallback = (error: Error | null, stdout?: string) => void;

function mockBundles(resolved: Record<string, string>, iconless: string[] = []) {
  mocks.execFile.mockImplementation(
    (cmd: string, args: string[], _opts: unknown, cb: ExecCallback) => {
      if (cmd === 'osascript') {
        const ids = JSON.parse(args[args.length - 1]) as string[];
        return cb(
          null,
          JSON.stringify(Object.fromEntries(ids.map((id) => [id, resolved[id] ?? null])))
        );
      }
      if (cmd === 'plutil') {
        return iconless.some((bundle) => args[3].startsWith(bundle))
          ? cb(new Error('No value at that key path'))
          : cb(null, 'AppIcon\n');
      }
      if (cmd === 'sips') writeFileSync(args[args.indexOf('--out') + 1], 'png');
      cb(null, '');
    }
  );
}

function mockSpawn() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  return child;
}

describe('buildLaunchArgs', () => {
  it('appends the directory by default and substitutes {path} when present', () => {
    expect(buildLaunchArgs(undefined, '/repo')).toEqual(['/repo']);
    expect(buildLaunchArgs(['-d'], '/repo')).toEqual(['-d', '/repo']);
    expect(buildLaunchArgs(['--working-directory={path}'], '/repo')).toEqual([
      '--working-directory=/repo',
    ]);
  });
});

describe('createOpenInApps', () => {
  let binDir: string;

  beforeEach(() => {
    mocks.execFile.mockReset();
    mocks.spawn.mockReset();
    mocks.getFileIcon.mockReset().mockResolvedValue({
      isEmpty: () => false,
      toDataURL: () => 'data:image/png;base64,icon',
    });
    binDir = mkdtempSync(path.join(tmpdir(), 'enso-open-in-'));
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it('macOS 只列出 Launch Services 能解析的应用，保持注册表顺序并附 bundle 图标', async () => {
    mockBundles(
      {
        'com.googlecode.iterm2': '/Applications/iTerm.app',
        'com.microsoft.VSCode': '/Applications/Visual Studio Code.app',
        'com.sublimetext.3': '/Applications/Sublime Text.app',
      },
      ['/Applications/iTerm.app']
    );
    const apps = await createOpenInApps({ platform: 'darwin' }).list();
    const icon = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
    expect(apps).toEqual([
      { id: 'vscode', name: 'VS Code', kind: 'editor', icon },
      { id: 'sublime', name: 'Sublime Text', kind: 'editor', icon },
      { id: 'iterm2', name: 'iTerm2', kind: 'terminal' },
    ]);
    expect(mocks.execFile).toHaveBeenCalledWith(
      'sips',
      expect.arrayContaining(['/Applications/Sublime Text.app/Contents/Resources/AppIcon.icns']),
      expect.anything(),
      expect.any(Function)
    );
    // Electron 的 getFileIcon 对 .app 只返回通用图标
    expect(mocks.getFileIcon).not.toHaveBeenCalled();
  });

  it('探测失败返回空列表且不缓存，下次重新探测', async () => {
    mocks.execFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => cb(new Error('boom'))
    );
    const openInApps = createOpenInApps({ platform: 'darwin' });
    await expect(openInApps.list()).resolves.toEqual([]);
    mockBundles({ 'com.apple.Terminal': '/System/Applications/Utilities/Terminal.app' });
    await expect(openInApps.list()).resolves.toMatchObject([{ id: 'apple-terminal' }]);
  });

  it('Linux 只认 PATH 上可执行的二进制', async () => {
    for (const [name, mode] of [
      ['code', 0o755],
      ['ghostty', 0o755],
      ['cursor', 0o644],
    ] as const) {
      writeFileSync(path.join(binDir, name), '');
      chmodSync(path.join(binDir, name), mode);
    }
    const apps = await createOpenInApps({
      platform: 'linux',
      env: { PATH: `/missing:${binDir}` },
    }).list();
    expect(apps).toEqual([
      { id: 'vscode', name: 'VS Code', kind: 'editor' },
      { id: 'ghostty', name: 'Ghostty', kind: 'terminal' },
    ]);
  });

  it('拒绝未探测到的 appId，不启动任何进程', async () => {
    mockBundles({});
    await expect(createOpenInApps({ platform: 'darwin' }).open('vscode', '/repo')).resolves.toEqual(
      { ok: false, error: 'unavailable' }
    );
    expect(mocks.execFile).not.toHaveBeenCalledWith(
      'open',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('macOS 用 open -a <bundle> <dir> 打开', async () => {
    mockBundles({ 'com.microsoft.VSCode': '/Applications/Visual Studio Code.app' });
    await expect(createOpenInApps({ platform: 'darwin' }).open('vscode', '/repo')).resolves.toEqual(
      { ok: true }
    );
    expect(mocks.execFile).toHaveBeenCalledWith(
      'open',
      ['-a', '/Applications/Visual Studio Code.app', '/repo'],
      expect.anything(),
      expect.any(Function)
    );
  });

  it('Linux 终端按注册参数带工作目录 detached 启动', async () => {
    writeFileSync(path.join(binDir, 'ghostty'), '');
    chmodSync(path.join(binDir, 'ghostty'), 0o755);
    const child = mockSpawn();
    await expect(
      createOpenInApps({ platform: 'linux', env: { PATH: binDir } }).open('ghostty', '/repo')
    ).resolves.toEqual({ ok: true });
    expect(mocks.spawn).toHaveBeenCalledWith(
      path.join(binDir, 'ghostty'),
      ['--working-directory=/repo'],
      expect.objectContaining({ cwd: '/repo', detached: true, stdio: 'ignore' })
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it('启动失败转换为结构化错误', async () => {
    mockBundles({ 'com.microsoft.VSCode': '/Applications/Visual Studio Code.app' });
    const openInApps = createOpenInApps({ platform: 'darwin' });
    await openInApps.list();
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
        cb(new Error('Unable to find application'))
    );
    await expect(openInApps.open('vscode', '/repo')).resolves.toEqual({
      ok: false,
      error: 'Unable to find application',
    });
  });
});
