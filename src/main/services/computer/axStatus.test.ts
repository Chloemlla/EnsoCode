import { describe, expect, it } from 'vitest';
import { describeAxOutcome } from './axStatus';

describe('describeAxOutcome', () => {
  it('TCC 未授权和空树、超时分开说', () => {
    expect(describeAxOutcome({ trusted: false, status: 0, nodeCount: 0 })).toMatch(/tcc-denied/);
    expect(describeAxOutcome({ trusted: true, status: -25211, nodeCount: 0 })).toMatch(
      /tcc-denied/
    );
    expect(describeAxOutcome({ trusted: true, status: -25204, nodeCount: 0 })).toMatch(/timeout/);
    expect(describeAxOutcome({ trusted: true, status: 0, nodeCount: 0 })).toMatch(/ax-empty/);
  });

  it('有节点时不报失败', () => {
    expect(describeAxOutcome({ trusted: true, status: 0, nodeCount: 3 })).toBeNull();
  });
});
