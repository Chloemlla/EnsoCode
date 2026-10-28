const REFUSAL_PATTERNS: RegExp[] = [
  /\bi'?m sorry,? but i (can'?t|cannot|won'?t|am unable)/i,
  /\bi (can'?t|cannot|won'?t|am not able to) (help|assist|do|provide|comply)/i,
  /\bi (must|have to) (decline|refuse)/i,
  /\bas an ai (language )?(model|assistant)/i,
  /\bi'?m (just )?an ai\b/i,
  /\b(i|we) (can'?t|cannot) (provide|give|offer) (that|this|assistance)/i,
  /\bnot (able|allowed) to (assist|help|provide)/i,
  /\bagainst (my|our) (guidelines|policy|policies|usage)/i,
  /\bthis (request|content) (violates|goes against)/i,
  /我(无法|不能)(协助|帮助|提供|回答|满足)/,
  /抱歉[，,、]?.{0,8}(无法|不能|不便)/,
  /作为(一个)?(AI|人工智能|语言模型)/,
  /(违反|不符合)(了)?(相关)?(政策|规定|规范|准则|条款)/,
  /(建议|请)(你|您)?(咨询|联系|寻求).{0,10}(专业人士|律师|安全团队|官方)/,
  /\bconflicting (instructions?|requirements)\b/i,
  /\bi (detect|detected|see|noticed) (an? )?(instruction )?conflict\b/i,
  /\b(cannot|can'?t) (both|simultaneously) (comply|satisfy|do|follow)\b/i,
  /\bfollow(ing)? the (stricter|safety|security) (policy|rule|guideline)/i,
  /检测到.{0,20}冲突|冲突(的)?指令|指令(存在)?冲突|存在冲突/,
  /(核心)?安全(规则|限制|策略|准则).{0,20}(禁止|不允许|不允许我)/,
  /将(直接)?拒绝.{0,8}请求/,
];

/**
 * 推脱检测：只看开头一段。已有大段代码围栏或条目化交付物直接放行。
 */
export function looksLikeRefusal(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  const fence = body.match(/```[\s\S]{200,}?```/);
  if (fence) return false;
  const head = body.slice(0, 600);
  if (head.length > 380 && /(^|\n)\s*(\d+\.|[-*])\s/.test(head)) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(head));
}
