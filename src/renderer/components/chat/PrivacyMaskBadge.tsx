import { groupMaskHits, type MaskReport, strongestAction } from '@shared/privacyMask/report';
import type { MaskAction } from '@shared/privacyMask/settings';
import { Shield, ShieldAlert, ShieldX } from 'lucide-react';
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from '@/components/ui/preview-card';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

const TONE: Record<MaskAction, string> = {
  mask: 'text-sky-600 dark:text-sky-400',
  warn: 'text-amber-600 dark:text-amber-400',
  block: 'text-red-600 dark:text-red-400',
};
const ICON = { mask: Shield, warn: ShieldAlert, block: ShieldX } as const;
const ACTION_LABEL: Record<MaskAction, string> = {
  mask: 'Mask',
  warn: 'Warn only',
  block: 'Block',
};
const WHERE_LABEL: Record<string, string> = {
  system: 'System prompt',
  user: 'Your message',
  tool_result: 'Tool output',
  tool_args: 'Tool arguments',
  assistant: 'Earlier replies',
  tools: 'Tool descriptions',
};

/** 回复身份头上的盾牌：按最重动作着色，悬浮列出类型 / 位置 / 动作；不含原值 */
export function PrivacyMaskBadge({ report }: { report: MaskReport }) {
  const { t } = useI18n();
  const action = strongestAction(report);
  if (!action) return null;
  const Icon = ICON[action];
  // 每次请求都会带上历史上下文，按出现次数会把同一个值重复计数；徽标数字按不同值计
  const total = new Set(report.hits.map((h) => h.token)).size;
  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={
          <span
            className={cn('inline-flex shrink-0 items-center gap-0.5 text-[11px]', TONE[action])}
            data-privacy-mask={action}
          />
        }
      >
        <Icon className="size-3.5" />
        <span className="tabular-nums">{total}</span>
      </PreviewCardTrigger>
      <PreviewCardPopup className="max-h-(--available-height) w-72 flex-col overflow-y-auto overscroll-contain text-xs">
        <p className="mb-1.5 font-medium">{t('Privacy masking')}</p>
        <ul className="space-y-1">
          {groupMaskHits(report.hits).map((g) => (
            <li key={`${g.action}-${g.kind}-${g.where}`} className="flex flex-wrap gap-x-2">
              <span className={TONE[g.action]}>{t(ACTION_LABEL[g.action])}</span>
              <span>{g.kind}</span>
              <span className="text-muted-foreground">{t(WHERE_LABEL[g.where] ?? g.where)}</span>
              <span className="text-muted-foreground">
                {g.values > 1 ? t('{{count}} values', { count: g.values }) : g.preview}
              </span>
              {g.count > 1 && <span className="text-muted-foreground">×{g.count}</span>}
            </li>
          ))}
        </ul>
        {report.restored > 0 && (
          <p className="mt-1.5 text-muted-foreground">
            {t('Restored {{count}} in the reply', { count: report.restored })}
          </p>
        )}
      </PreviewCardPopup>
    </PreviewCard>
  );
}
