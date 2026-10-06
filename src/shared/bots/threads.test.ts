import { describe, expect, it } from 'vitest';
import { threadTitleFrom } from './threads';

describe('threadTitleFrom', () => {
  it('取首个非空行，压缩空白，超长截断加省略号', () => {
    expect(threadTitleFrom('\n  发布   清单\n第二行')).toBe('发布 清单');
    expect(threadTitleFrom('a'.repeat(40))).toBe(`${'a'.repeat(30)}…`);
    expect(threadTitleFrom('   \n ')).toBeUndefined();
  });
});
