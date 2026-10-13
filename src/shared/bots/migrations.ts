/**
 * Bot 持久化记录的 schema 版本（与乐观并发的 `version` 无关）。
 * 缺省 schemaVersion 视为第 1 版；读盘后、parse 前统一跑 migrateRecord。
 * 新增破坏性格式变化时：在对应 STEPS 末尾追加一步（第 i 步把 i+1 版升到 i+2 版），版本号自动 +1。
 */
export type BotRecordKind = 'bot' | 'chat' | 'routines' | 'delegation' | 'task';

type Step = (value: Record<string, unknown>) => Record<string, unknown>;

/** 第 2 版只新增「卡住」状态与字段，读第 1 版不用改内容 */
const same: Step = (value) => value;

const STEPS: Record<BotRecordKind, readonly Step[]> = {
  bot: [],
  chat: [],
  routines: [],
  delegation: [same],
  task: [same],
};

export const BOT_SCHEMA_VERSION: Record<BotRecordKind, number> = {
  bot: STEPS.bot.length + 1,
  chat: STEPS.chat.length + 1,
  routines: STEPS.routines.length + 1,
  delegation: STEPS.delegation.length + 1,
  task: STEPS.task.length + 1,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const blockedTask = (value: Record<string, unknown>) =>
  value.status === 'blocked' ||
  value.blockedReason !== undefined ||
  value.blockedNeed !== undefined ||
  value.blockedStreak !== undefined ||
  (Array.isArray(value.runs) && value.runs.some((run) => isObject(run) && run.state === 'blocked'));

/**
 * 委派 / 任务只有用到第 2 版内容（卡住）的记录才写 2，其余仍写 1：
 * 旧版本照常读写普通记录，把带新状态的当未来记录原样保留，降级看不见但不丢。
 */
const RECORD_VERSION: Partial<Record<BotRecordKind, (value: Record<string, unknown>) => number>> = {
  delegation: (value) => (value.state === 'blocked' || value.blocked !== undefined ? 2 : 1),
  task: (value) => (blockedTask(value) ? 2 : 1),
};

/** 非对象原样返回交给 parse 拒绝；更新版本写出的记录返回 undefined（不做有损降级） */
export function runMigrations(value: unknown, steps: readonly Step[]): unknown {
  if (!isObject(value)) return value;
  const current = steps.length + 1;
  const from = value.schemaVersion ?? 1;
  if (!Number.isSafeInteger(from) || (from as number) < 1 || (from as number) > current)
    return undefined;
  if (from === current) return value;
  let next = value;
  for (let version = from as number; version < current; version++) next = steps[version - 1](next);
  return { ...next, schemaVersion: current };
}

export function migrateRecord(kind: BotRecordKind, value: unknown): unknown {
  return runMigrations(value, STEPS[kind]);
}

export function withSchemaVersion<T extends object>(
  kind: BotRecordKind,
  record: T
): T & { schemaVersion: number } {
  const version =
    RECORD_VERSION[kind]?.(record as Record<string, unknown>) ?? BOT_SCHEMA_VERSION[kind];
  return { schemaVersion: version, ...record };
}

/** 记录是否由更新版本写出（压缩重写时须原样保留，不能丢） */
export function isFutureRecord(kind: BotRecordKind, value: unknown): boolean {
  return (
    isObject(value) &&
    Number.isSafeInteger(value.schemaVersion) &&
    (value.schemaVersion as number) > BOT_SCHEMA_VERSION[kind]
  );
}
