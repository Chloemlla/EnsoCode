import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProjectSkills, readSkillsRoot } from './skills';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-skills-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSkill(root: string, dir: string, frontmatter: string | null, body = '正文') {
  const skillDir = path.join(root, dir);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = frontmatter === null ? body : `---\n${frontmatter}\n---\n\n${body}`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
  return skillDir;
}

describe('readSkillsRoot', () => {
  it('从 frontmatter 读取名称与描述', () => {
    writeSkill(tmp, 'cloudflare', 'name: cloudflare\ndescription: Cloudflare 平台技能');
    const [skill] = readSkillsRoot(tmp, 'Claude Code');
    expect(skill.name).toBe('cloudflare');
    expect(skill.description).toBe('Cloudflare 平台技能');
    expect(skill.groupName).toBe('Claude Code');
    expect(skill.path).toBe(path.join(tmp, 'cloudflare'));
  });

  it('frontmatter 缺 name 时回退到目录名', () => {
    writeSkill(tmp, 'my-skill', 'description: 只有描述');
    expect(readSkillsRoot(tmp, 'x')[0].name).toBe('my-skill');
  });

  it('完全没有 frontmatter 也能读出目录名', () => {
    writeSkill(tmp, 'plain', null);
    const [skill] = readSkillsRoot(tmp, 'x');
    expect(skill.name).toBe('plain');
    expect(skill.description).toBe('');
  });

  it('frontmatter 是坏 YAML 时不抛错，回退目录名', () => {
    writeSkill(tmp, 'broken', 'name: [unclosed\n  bad: : :');
    const [skill] = readSkillsRoot(tmp, 'x');
    expect(skill.name).toBe('broken');
  });

  it('跳过没有 SKILL.md 的目录', () => {
    fs.mkdirSync(path.join(tmp, 'not-a-skill'));
    writeSkill(tmp, 'real', 'name: real');
    const skills = readSkillsRoot(tmp, 'x');
    expect(skills.map((s) => s.name)).toEqual(['real']);
  });

  it('跳过根目录下的散文件', () => {
    fs.writeFileSync(path.join(tmp, 'README.md'), '# 不是技能');
    expect(readSkillsRoot(tmp, 'x')).toEqual([]);
  });

  it('目录不存在时返回空数组', () => {
    expect(readSkillsRoot(path.join(tmp, 'nope'), 'x')).toEqual([]);
  });

  it('跟随指向技能目录的符号链接', () => {
    const real = writeSkill(
      path.join(tmp, 'origin'),
      'surge',
      'name: Surge\ndescription: surge-cli'
    );
    const root = path.join(tmp, 'skills');
    fs.mkdirSync(root);
    const linked = path.join(root, 'surge');
    fs.symlinkSync(real, linked);
    expect(readSkillsRoot(root, 'Claude Code')).toEqual([
      {
        name: 'Surge',
        description: 'surge-cli',
        path: linked,
        groupName: 'Claude Code',
      },
    ]);
  });

  it('跳过悬空符号链接和指向文件的符号链接', () => {
    const root = path.join(tmp, 'skills');
    fs.mkdirSync(root);
    fs.symlinkSync(path.join(tmp, 'missing'), path.join(root, 'dangling'));
    fs.writeFileSync(path.join(tmp, 'plain.txt'), 'not a skill');
    fs.symlinkSync(path.join(tmp, 'plain.txt'), path.join(root, 'filelink'));
    expect(readSkillsRoot(root, 'x')).toEqual([]);
  });
});

describe('listProjectSkills', () => {
  it('spawn 前菜单覆盖 pi 运行时的全部自动发现根:项目 + 用户全局', () => {
    // pi 会自动发现 ~/.pi/agent/skills 与 ~/.agents/skills(docs/skills.md),
    // spawn 前的斜杠菜单漏掉全局根会导致"新会话没有 /skill"
    const cwd = path.join(tmp, 'proj');
    const home = path.join(tmp, 'home');
    writeSkill(path.join(cwd, '.agents', 'skills'), 'proj-a', 'name: proj-a\ndescription: p');
    writeSkill(path.join(home, '.agents', 'skills'), 'global-a', 'name: global-a\ndescription: g');
    writeSkill(
      path.join(home, '.pi', 'agent', 'skills'),
      'global-b',
      'name: global-b\ndescription: g2'
    );
    const names = listProjectSkills(cwd, home).map((skill) => skill.name);
    expect(names).toContain('proj-a');
    expect(names).toContain('global-a');
    expect(names).toContain('global-b');
  });

  it('同名 skill 项目优先,全局根不重复上报', () => {
    const cwd = path.join(tmp, 'proj');
    const home = path.join(tmp, 'home');
    writeSkill(path.join(cwd, '.agents', 'skills'), 'dup', 'name: dup\ndescription: project');
    writeSkill(path.join(home, '.agents', 'skills'), 'dup', 'name: dup\ndescription: global');
    const skills = listProjectSkills(cwd, home);
    expect(skills.filter((skill) => skill.name === 'dup')).toEqual([
      { name: 'dup', description: 'project' },
    ]);
  });
});

describe('listProjectSkills · harness 根', () => {
  it('includeHarness 时追加项目内 .claude/.codex/.cursor 的 skills；缺省不含', () => {
    const cwd = path.join(tmp, 'proj');
    const home = path.join(tmp, 'home');
    writeSkill(path.join(cwd, '.claude', 'skills'), 'cc-only', 'name: cc-only\ndescription: c');
    writeSkill(path.join(cwd, '.cursor', 'skills'), 'cur-only', 'name: cur-only\ndescription: u');
    expect(listProjectSkills(cwd, home).map((s) => s.name)).toEqual([]);
    const names = listProjectSkills(cwd, home, { includeHarness: true }).map((s) => s.name);
    expect(names).toEqual(['cc-only', 'cur-only']);
  });

  it('harness 根里的同名 skill 不覆盖 .agents/skills 的', () => {
    const cwd = path.join(tmp, 'proj');
    const home = path.join(tmp, 'home');
    writeSkill(path.join(cwd, '.agents', 'skills'), 'dup', 'name: dup\ndescription: agents');
    writeSkill(path.join(cwd, '.claude', 'skills'), 'dup', 'name: dup\ndescription: claude');
    expect(listProjectSkills(cwd, home, { includeHarness: true })).toEqual([
      { name: 'dup', description: 'agents' },
    ]);
  });
});
