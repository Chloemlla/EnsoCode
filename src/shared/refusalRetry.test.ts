import { describe, expect, it } from 'vitest';
import { looksLikeRefusal } from './refusalRetry';

describe('looksLikeRefusal', () => {
  it('英文推脱句式命中', () => {
    for (const text of [
      "I'm sorry, but I can't help with that.",
      "I can't assist with this request.",
      'As an AI language model, I must decline.',
      'This request violates my usage policies.',
      "I'm not able to provide that information.",
    ]) {
      expect(looksLikeRefusal(text), text).toBe(true);
    }
  });

  it('中文推脱句式命中', () => {
    for (const text of [
      '抱歉，我无法协助进行这类操作。',
      '作为一个人工智能助手，我不能提供该内容。',
      '这违反了相关规定，建议你咨询专业人士。',
    ]) {
      expect(looksLikeRefusal(text), text).toBe(true);
    }
  });

  it('冲突指令后改走安全策略也算推脱', () => {
    expect(
      looksLikeRefusal(
        'I detected an instruction conflict and will follow the stricter safety policy.'
      )
    ).toBe(true);
    expect(looksLikeRefusal('检测到系统存在冲突指令。我将严格遵循安全限制。')).toBe(true);
  });

  it('空回复、命令、大段代码围栏、条目化步骤不算推脱', () => {
    expect(looksLikeRefusal('')).toBe(false);
    expect(looksLikeRefusal('pnpm test')).toBe(false);
    expect(
      looksLikeRefusal(`I'm sorry this is late. Here is the patch:
\`\`\`ts
${'const x = 1;\n'.repeat(40)}\`\`\``)
    ).toBe(false);
    expect(
      looksLikeRefusal(`步骤：
1. 打开设置
2. 新建预设
3. 勾选本机 MCP
4. 保存
5. 新开会话验证
6. 冷恢复再验证
7. 确认子会话仍带 tail`)
    ).toBe(false);
  });
});
