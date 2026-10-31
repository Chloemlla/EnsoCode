import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitStaged, pluginPackagePath, stagePlugin } from './install';

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const manifest = {
  schemaVersion: 1,
  id: 'example.demo',
  name: 'Demo',
  version: '1.0.0',
  main: 'main.js',
  permissions: ['agent.tool'],
  contributes: {
    agentTools: [{ name: 'lookup', description: 'd', parameters: { type: 'object' } }],
  },
};

function writePlugin(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

describe('stagePlugin（目录来源）', () => {
  it('复制到暂存区并解析清单', async () => {
    const src = temp('src-');
    const root = temp('root-');
    writePlugin(src, {
      'enso-plugin.json': JSON.stringify(manifest),
      'main.js': 'export {}',
      '.git/HEAD': 'x',
    });
    const result = await stagePlugin(root, { kind: 'dir', path: src }, '0.2.12');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.staged.manifest.id).toBe('example.demo');
    expect(existsSync(join(result.staged.pluginRoot, 'main.js'))).toBe(true);
    expect(existsSync(join(result.staged.pluginRoot, '.git'))).toBe(false);
    expect(result.staged.pluginRoot.startsWith(root)).toBe(true);
  });

  it('缺清单、清单不合法、引用文件不存在都失败且不留暂存文件', async () => {
    const root = temp('root-');
    const noManifest = temp('src-');
    writePlugin(noManifest, { 'main.js': '' });
    const bad = temp('src-');
    writePlugin(bad, { 'enso-plugin.json': '{"schemaVersion":2}' });
    const missingMain = temp('src-');
    writePlugin(missingMain, { 'enso-plugin.json': JSON.stringify(manifest) });
    for (const src of [noManifest, bad, missingMain]) {
      const result = await stagePlugin(root, { kind: 'dir', path: src }, '0.2.12');
      expect(result.ok).toBe(false);
    }
    expect(existsSync(join(root, 'staging')) ? readdirSync(join(root, 'staging')) : []).toEqual([]);
  });

  it('拒绝包含符号链接的插件目录', async () => {
    const src = temp('src-');
    const root = temp('root-');
    writePlugin(src, { 'enso-plugin.json': JSON.stringify(manifest), 'main.js': '' });
    symlinkSync('/etc', join(src, 'escape'));
    const result = await stagePlugin(root, { kind: 'dir', path: src }, '0.2.12');
    expect(result.ok).toBe(false);
  });

  it('引用的 skills 必须是插件内的目录', async () => {
    const src = temp('src-');
    const root = temp('root-');
    writePlugin(src, {
      'enso-plugin.json': JSON.stringify({
        ...manifest,
        contributes: { ...manifest.contributes, skills: ['skills/x'] },
      }),
      'main.js': '',
      'skills/x': 'not a dir',
    });
    expect((await stagePlugin(root, { kind: 'dir', path: src }, '0.2.12')).ok).toBe(false);
  });
});

describe('commitStaged', () => {
  it('把暂存目录移到 packages/<id>/<dir>', async () => {
    const src = temp('src-');
    const root = temp('root-');
    writePlugin(src, { 'enso-plugin.json': JSON.stringify(manifest), 'main.js': 'export {}' });
    const result = await stagePlugin(root, { kind: 'dir', path: src }, '0.2.12');
    if (!result.ok) throw new Error(result.error);
    const dir = commitStaged(root, result.staged);
    const installed = pluginPackagePath(root, 'example.demo', dir);
    expect(readFileSync(join(installed, 'main.js'), 'utf8')).toBe('export {}');
    expect(existsSync(result.staged.pluginRoot)).toBe(false);
  });
});
