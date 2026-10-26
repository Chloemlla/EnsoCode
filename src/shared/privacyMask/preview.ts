import { type MaskReport, MaskReportBuilder } from './report';
import { compileRules, findSpans } from './rules';
import type { PrivacyMaskSettings } from './settings';
import { PrivacyVault } from './vault';

/** 预览用的非密码学摘要：只为生成形如真实占位符的样子，不出本机、不与 worker 一致 */
function previewDigest(data: string): Uint8Array {
  const out = new Uint8Array(32);
  let h = 0x811c9dc5;
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < data.length; j++) {
      h ^= data.charCodeAt(j) + i;
      h = Math.imul(h, 0x01000193);
    }
    out[i] = h & 0xff;
  }
  return out;
}

export function previewMask(
  text: string,
  settings: PrivacyMaskSettings
): { text: string; report: MaskReport } {
  const vault = new PrivacyVault({ digest: previewDigest });
  vault.configure(settings);
  const report = new MaskReportBuilder();
  return { text: vault.mask(text, 'user', report), report: report.build() };
}

/** 输入框发送前预检：拦截类在乐观回显之前拒绝 */
export function scanUserInput(
  text: string,
  settings: PrivacyMaskSettings
): { masked: number; blocked: string[] } {
  const spans = findSpans(text, compileRules(settings));
  return {
    masked: spans.filter((s) => s.action === 'mask').length,
    blocked: [...new Set(spans.filter((s) => s.action === 'block').map((s) => s.kind))],
  };
}
