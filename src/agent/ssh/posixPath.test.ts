import { describe, expect, it } from 'vitest';
import { applyRemoteWorkingDirectory, toPosixRemotePath } from './posixPath';

describe('toPosixRemotePath', () => {
  it('把 Windows 盘符根路径还原成 POSIX', () => {
    expect(toPosixRemotePath('D:/root/semble')).toBe('/root/semble');
    expect(toPosixRemotePath('D:\\root\\semble')).toBe('/root/semble');
    expect(toPosixRemotePath('/root/semble')).toBe('/root/semble');
  });
});

describe('applyRemoteWorkingDirectory', () => {
  it('把结构化 cwd 改成远端 POSIX 路径并加 ssh 段，保留其他段', () => {
    const options = { cwd: 'D:\\root\\semble', sections: { mcp_servers: 'x' } };
    applyRemoteWorkingDirectory(options, 'D:/root/semble', 'user@box');
    expect(options.cwd).toBe('/root/semble');
    expect(options.sections.mcp_servers).toBe('x');
    expect(options.sections).toHaveProperty('ssh');
    expect((options.sections as Record<string, string>).ssh).toContain('user@box');
  });
});
