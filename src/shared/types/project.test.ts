import { describe, expect, it } from 'vitest';
import { projectTrustedCode } from './project';

describe('projectTrustedCode', () => {
  const projects = [
    { id: 'a', trustedProjectCode: ['.pi/extensions/x.ts', 1, ''] },
    { id: 'b' },
    null,
  ];

  it('取出项目已信任的代码来源，丢弃脏值', () => {
    expect(projectTrustedCode(projects, 'a')).toEqual(['.pi/extensions/x.ts']);
  });

  it('未信任、缺项目或坏配置时为空', () => {
    expect(projectTrustedCode(projects, 'b')).toEqual([]);
    expect(projectTrustedCode(projects, 'missing')).toEqual([]);
    expect(projectTrustedCode('bad', 'a')).toEqual([]);
    expect(projectTrustedCode(projects, undefined)).toEqual([]);
  });
});
