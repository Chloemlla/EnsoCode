import { chatThreads } from '@shared/bots/threads';
import type { BotChat } from '@shared/types/bot';
import { Check, ChevronDown, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/chat/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useBotsStore } from '@/stores/bots';
import { chatSummary } from '@/stores/bots/selectors';
import { isUnread } from '@/stores/bots/unread';
import { chatErrorText } from './botText';

const BUTTON =
  'flex h-7 items-center gap-1 rounded-md border px-2 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50';

/** 群话题切换：列出根群与其话题，新建 / 改名 / 删除；切走的话题在后台照常运行 */
export function ThreadSwitcher({ group, thread }: { group: BotChat; thread: BotChat }) {
  const { t, locale } = useI18n();
  const chats = useBotsStore((s) => s.chats);
  const sessions = useBotsStore((s) => s.sessions);
  const timelines = useBotsStore((s) => s.timelines);
  const queue = useBotsStore((s) => s.queue);
  const reads = useBotsStore((s) => s.reads);
  const bots = useBotsStore((s) => s.bots);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const archived = group.archivedAt !== undefined;
  const names = useMemo(() => Object.fromEntries(bots.map((bot) => [bot.id, bot.name])), [bots]);
  const threads = chatThreads(chats, group).map((chat) => {
    const summary = chatSummary(chat, { sessions, timeline: timelines[chat.id], queue, names });
    return { chat, summary, unread: isUnread(summary.marker, reads[summary.key]) };
  });
  const label = (chat: BotChat) =>
    chat.threadTitle ?? (chat.parentId ? t('New topic') : t('Main topic'));

  const create = async () => {
    if (!(await useBotsStore.getState().createThread(group.id)))
      addToast({ type: 'error', title: t('Could not create topic') });
  };
  const remove = async () => {
    const result = await window.electronAPI.bots.deleteThread(thread.id);
    if (!result.ok) addToast({ type: 'error', title: chatErrorText(result.error, t) });
    void useBotsStore.getState().refreshChats();
  };

  return (
    <>
      <Menu>
        <MenuTrigger className={cn(BUTTON, 'max-w-56')}>
          <span className="truncate">{label(thread)}</span>
          {threads.some((item) => item.chat.id !== thread.id && item.unread) && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </MenuTrigger>
        <MenuPopup align="end" className="w-72">
          <MenuGroup>
            <MenuGroupLabel>{t('Topics')}</MenuGroupLabel>
            {threads.map(({ chat, summary, unread }) => (
              <MenuItem
                key={chat.id}
                onClick={() => useBotsStore.getState().openThread(group.id, chat.id)}
              >
                <Check className={cn(chat.id !== thread.id && 'invisible')} />
                <span className="min-w-0 flex-1 truncate">{label(chat)}</span>
                {summary.running && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
                {unread && chat.id !== thread.id && (
                  <span className="h-1.5 w-1.5 rounded-full bg-info" />
                )}
                {summary.activityAt > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {formatRelativeTime(summary.activityAt, locale)}
                  </span>
                )}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem disabled={archived} onClick={() => void create()}>
            <MessageSquarePlus />
            {t('New topic')}
          </MenuItem>
          <MenuItem disabled={archived} onClick={() => setRenaming(label(thread))}>
            <Pencil />
            {t('Rename topic')}
          </MenuItem>
          {thread.parentId && (
            <MenuItem variant="destructive" onClick={() => setDeleting(true)}>
              <Trash2 />
              {t('Delete topic')}
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
      <button type="button" disabled={archived} onClick={() => void create()} className={BUTTON}>
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {t('New topic')}
      </button>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('Delete this topic?')}
        description={t(
          'Its messages and member sessions are removed; replies in progress are stopped. Group notes, memory and the task board stay.'
        )}
        confirmLabel={t('Delete')}
        onConfirm={() => void remove()}
      />
      {renaming !== null && (
        <RenameDialog
          initial={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (title) => {
            const result = await window.electronAPI.bots.renameThread(thread.id, title);
            if (!result.ok) {
              addToast({ type: 'error', title: chatErrorText(result.error, t) });
              return;
            }
            useBotsStore.getState().upsertChat(result.chat);
            setRenaming(null);
          }}
        />
      )}
    </>
  );
}

function RenameDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initial);
  const save = () => {
    if (title.trim()) void onSave(title.trim());
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Rename topic')}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Input
            value={title}
            autoFocus
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && save()}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={!title.trim()} onClick={save}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
