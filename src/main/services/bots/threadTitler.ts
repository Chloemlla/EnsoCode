import { randomUUID } from 'node:crypto';
import { isSkipReply } from '@shared/bots/router';
import { threadTitleFrom } from '@shared/bots/threads';
import type { ProjectedMessage, SpawnModelConfig } from '@shared/types/agent';
import type { BotChat, Delegation, GroupEntry } from '@shared/types/bot';
import type { BotChatStateResult } from '@shared/types/botIpc';
import {
  buildInitialTitleUserText,
  buildRollingTitleUserText,
  buildTurnDigest,
  extractTitle,
  ROLLING_TITLE_SYSTEM_PROMPT,
  TITLE_SYSTEM_PROMPT,
  titleRejectReason,
  titleSummaryTimeoutMs,
} from '../../../agent/titleSummary';
import type { BotChatStore } from './chatStore';

/** 轮结束信号的静默窗口：同一轮的多个结束事件合并为一次判定，也等群接力把刚结束的回合归并完 */
const QUIET_MS = 1_500;
/** 一轮最多取这么多条时间线做摘要（readSince 缺口过大时退回最新一页） */
const ROUND_SCAN_LIMIT = 200;
/** 找开场请求（主旨锚点）时从对话起点往后看的条数 */
const OPENING_SCAN = 40;
/** initial 命名时找刚落盘的人类消息 */
const RECENT_SCAN = 20;

/** 话题内正在进行的工作：群接力、成员会话、宿主排队、委派 */
export interface ThreadWork {
  groupState(chatId: string): BotChatStateResult;
  conversationBusy(conversationId: string): boolean;
  queued(chatId: string): boolean;
  delegations(chatId: string): readonly Delegation[];
}

/**
 * 话题内是否还有成员在工作（「一轮」未结束）：接力进行中 / 排队 / 待处理的人类消息 / 智能选人中、
 * 任一成员会话在跑或有排队投递、委派排队或运行中、委派已结束但结果还没送回当前发起会话。
 * 发起会话已换代（新对话 / 移除成员）的委派结果不会再送回，不算在内，避免话题永远等不到结束。
 */
export function threadWorkPending(chat: BotChat, work: ThreadWork): boolean {
  const state = work.groupState(chat.id);
  if (state.ok && (state.current || state.queue.length || state.pendingHuman || state.routing))
    return true;
  if (Object.values(chat.sessions).some((s) => work.conversationBusy(s.conversationId)))
    return true;
  if (work.queued(chat.id)) return true;
  return work
    .delegations(chat.id)
    .some(
      (record) =>
        record.chatId === chat.id &&
        (record.state === 'queued' ||
          record.state === 'running' ||
          (record.deliveredAt === undefined &&
            chat.sessions[record.parentBotId]?.conversationId === record.parentConversationId))
    );
}

const isReply = (entry: GroupEntry): entry is Extract<GroupEntry, { kind: 'bot' }> =>
  entry.kind === 'bot' && entry.text.trim().length > 0 && !isSkipReply(entry.text);

function toMessage(entry: GroupEntry): ProjectedMessage | null {
  if (entry.kind === 'human')
    return { role: 'user', content: [{ type: 'text', text: entry.text }] };
  if (isReply(entry)) return { role: 'assistant', content: [{ type: 'text', text: entry.text }] };
  return null;
}

interface Job {
  /** initial：首条人类消息后命名，成员开工是常态；rolling：一轮结束后滚动，必须在话题空闲时才调用模型 */
  kind: 'initial' | 'rolling';
  systemPrompt: string;
  userText: string;
  /** 本次总结覆盖到的时间线 seq */
  seq: number;
}

interface Flight {
  /** 进行中又收到轮结束信号：结束后再判定一次 */
  again: boolean;
  requestId?: string;
}

export interface ThreadTitlerDeps {
  chats: Pick<BotChatStore, 'get' | 'update' | 'readSince' | 'readEntries' | 'lastSeq'>;
  /** 设置里的标题总结开关（Main 自读） */
  enabled: () => boolean;
  work: ThreadWork;
  /** 标题模型回退链解析出的候选；worker 不在线 / 未配置时为空 */
  candidates: () => Promise<SpawnModelConfig[]>;
  complete: (input: {
    requestId: string;
    systemPrompt: string;
    userText: string;
    candidates: SpawnModelConfig[];
    timeoutMs: number;
  }) => Promise<string>;
  abort?: (requestId: string) => void;
  emit: (chatId: string) => void;
  quietMs?: number;
}

/**
 * 群话题（含主话题）AI 自动命名：首条人类消息后 initial，之后每轮结束（话题内无人在工作）rolling。
 * 只处理带 autoTitle 标记的新群 / 新话题；手动改名删除标记即锁定。
 * 同一话题单飞：进行中再来的轮结束信号只记一笔，结束后重新判定，不并发调用模型。
 */
export class ThreadTitler {
  private readonly flights = new Map<string, Flight>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Set<Promise<void>>();
  private disposed = false;

  constructor(private readonly deps: ThreadTitlerDeps) {}

  /** 人类消息已落时间线：无标题时先取首句占位，尚未命名过的新话题做 initial 命名 */
  humanSent(chatId: string, text: string): void {
    if (this.disposed) return;
    const chat = this.deps.chats.get(chatId);
    if (chat?.kind !== 'group' || chat.archivedAt !== undefined) return;
    const auto = chat.autoTitle !== undefined && this.deps.enabled();
    // 子话题一直取首句；主话题只在自动命名时才占位，否则保持「主话题」
    if (!chat.threadTitle && (chat.parentId || auto)) {
      const placeholder = threadTitleFrom(text);
      if (
        placeholder &&
        this.deps.chats.update(chatId, (draft) => ({ ...draft, threadTitle: placeholder }))
      )
        this.deps.emit(chatId);
    }
    if (!auto || chat.autoTitle?.seq !== 0 || this.flights.has(chatId)) return;
    const userText = buildInitialTitleUserText(text);
    if (!userText) return;
    const seq =
      this.deps.chats
        .readEntries(chatId, { limit: RECENT_SCAN })
        .findLast((entry) => entry.kind === 'human')?.seq ?? this.deps.chats.lastSeq(chatId);
    this.start(chatId, { kind: 'initial', systemPrompt: TITLE_SYSTEM_PROMPT, userText, seq });
  }

  /** 话题里有回合 / 委派 / 接力批次结束：静默窗口后判定这一轮是否真正结束 */
  notify(chatId: string): void {
    if (this.disposed) return;
    clearTimeout(this.timers.get(chatId));
    const timer = setTimeout(() => {
      this.timers.delete(chatId);
      this.check(chatId);
    }, this.deps.quietMs ?? QUIET_MS);
    timer.unref?.();
    this.timers.set(chatId, timer);
  }

  /** 测试用：等进行中的总结全部落定 */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const flight of this.flights.values())
      if (flight.requestId) this.deps.abort?.(flight.requestId);
  }

  private check(chatId: string): void {
    if (this.disposed) return;
    const flight = this.flights.get(chatId);
    if (flight) {
      flight.again = true;
      return;
    }
    const chat = this.writable(chatId);
    if (!chat || threadWorkPending(chat, this.deps.work)) return;
    const job = this.rollingJob(chat);
    if (job) this.start(chatId, job);
  }

  /** 仍可自动命名的话题：存在、未锁定、未归档、开关开 */
  private writable(chatId: string): BotChat | undefined {
    const chat = this.deps.chats.get(chatId);
    return chat?.kind === 'group' &&
      chat.autoTitle !== undefined &&
      chat.archivedAt === undefined &&
      this.deps.enabled()
      ? chat
      : undefined;
  }

  /** 上次总结之后有成员发言才算新一轮；开场请求作主旨锚点 */
  private rollingJob(chat: BotChat): Job | null {
    const floor = chat.epochSeq ?? 0;
    const covered = Math.max(chat.autoTitle?.seq ?? 0, floor);
    if (this.deps.chats.lastSeq(chat.id) <= covered) return null;
    const round = this.deps.chats
      .readSince(chat.id, covered, ROUND_SCAN_LIMIT)
      .filter((entry) => entry.seq > covered);
    const last = round.at(-1);
    if (!last || !round.some(isReply)) return null;
    const opening = this.deps.chats
      .readEntries(chat.id, { beforeSeq: floor + OPENING_SCAN + 1, limit: OPENING_SCAN })
      .find((entry) => entry.seq > floor && entry.kind === 'human');
    const head = opening && opening.seq < round[0].seq ? [toMessage(opening)!] : [];
    const messages = [
      ...head,
      ...round.flatMap((entry) => {
        const message = toMessage(entry);
        return message ? [message] : [];
      }),
    ];
    const digest = buildTurnDigest(messages, head.length);
    if (!digest) return null;
    return {
      kind: 'rolling',
      systemPrompt: ROLLING_TITLE_SYSTEM_PROMPT,
      userText: buildRollingTitleUserText({
        kind: 'rolling',
        currentTitle: chat.threadTitle ?? '',
        ...digest,
      }),
      seq: last.seq,
    };
  }

  private start(chatId: string, job: Job): void {
    const flight: Flight = { again: false };
    this.flights.set(chatId, flight);
    const done = this.summarize(chatId, job, flight)
      .catch((error) => console.warn('[bots] thread title failed', error))
      .finally(() => {
        this.flights.delete(chatId);
        this.pending.delete(done);
        if (flight.again) this.notify(chatId);
      });
    this.pending.add(done);
  }

  /**
   * 发起模型调用前（候选解析返回后、每次换下一个候选前）重新确认仍该总结：话题仍可写；
   * rolling 还要求话题仍空闲——新一轮已开始就放弃，不写回、不推进 autoTitle.seq，等新一轮结束的信号重新判定。
   */
  private due(chatId: string, job: Job): boolean {
    if (this.disposed) return false;
    const chat = this.writable(chatId);
    if (!chat) return false;
    return job.kind === 'initial' || !threadWorkPending(chat, this.deps.work);
  }

  /**
   * 候选依次尝试（超时按下标递增）；首个通过 titleRejectReason 的结果胜出，全部失败保留当前标题。
   * 模型已返回的结果不再看工作状态：它只覆盖到 job.seq（已结束的那一轮），写回后新一轮仍会在结束时滚动。
   */
  private async summarize(chatId: string, job: Job, flight: Flight): Promise<void> {
    const candidates = await this.deps.candidates();
    if (candidates.length === 0) return;
    let title: string | undefined;
    for (const [index, candidate] of candidates.entries()) {
      if (!this.due(chatId, job)) return;
      const requestId = randomUUID();
      flight.requestId = requestId;
      try {
        const text = await this.deps.complete({
          requestId,
          systemPrompt: job.systemPrompt,
          userText: job.userText,
          candidates: [candidate],
          timeoutMs: titleSummaryTimeoutMs(index),
        });
        const extracted = extractTitle({ content: [{ type: 'text', text }], stopReason: 'stop' });
        if (!titleRejectReason(extracted)) {
          title = extracted;
          break;
        }
      } catch {
        // 换下一个候选
      } finally {
        delete flight.requestId;
      }
    }
    if (this.disposed) return;
    this.commit(chatId, job.seq, title);
  }

  /** 写回前重新校验：锁定 / 删除 / 归档 / 开关关后到达的结果一律丢弃 */
  private commit(chatId: string, seq: number, title: string | undefined): void {
    const before = this.writable(chatId);
    if (!before?.autoTitle) return;
    const changed = title !== undefined && title !== before.threadTitle;
    const saved = this.deps.chats.update(chatId, (draft) => ({
      ...draft,
      autoTitle: { seq: Math.max(draft.autoTitle?.seq ?? 0, seq) },
      ...(changed ? { threadTitle: title } : {}),
    }));
    if (saved && changed) this.deps.emit(chatId);
  }
}
