import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOT_SCHEMA_VERSION, migrateRecord, runMigrations } from '../../../shared/bots/migrations';
import { BotStore } from './botStore';
import { BotChatStore } from './chatStore';
import { DelegationStore } from './delegationStore';
import { GroupTaskStore } from './groupTaskStore';
import { BotRoutineStore } from './routineStore';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const D1 = '44444444-4444-4444-8444-444444444444';
const D2 = '55555555-5555-4555-8555-555555555555';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bot-schema-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const jsonLines = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
function put(path: string, value: unknown) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

describe('schemaVersion on persisted bot records', () => {
  it('bot.json: stamps on write, reads legacy, ignores newer schemas', () => {
    const store = new BotStore(join(root, 'bots'));
    const created = store.create({ name: 'Alice' }, []);
    if (!created.ok) throw new Error('create');
    const file = join(root, 'bots', created.bot.id, 'bot.json');
    expect(json(file)).toMatchObject({ schemaVersion: BOT_SCHEMA_VERSION.bot, version: 1 });
    expect(new BotStore(join(root, 'bots')).get(created.bot.id)).toEqual(created.bot);

    const { schemaVersion: _, ...legacy } = json(file);
    put(file, legacy);
    expect(new BotStore(join(root, 'bots')).get(created.bot.id)).toEqual(created.bot);
    put(file, { ...legacy, schemaVersion: BOT_SCHEMA_VERSION.bot + 1 });
    expect(new BotStore(join(root, 'bots')).get(created.bot.id)).toBeUndefined();
  });

  it('chat.json: stamps on write, reads legacy, ignores newer schemas', () => {
    const store = new BotChatStore(join(root, 'chats'));
    const chat = store.create({
      kind: 'group',
      title: 'g',
      members: [A, B],
      bossBotId: A,
      workspace: { kind: 'project', projectId: 'p' },
    });
    if (!chat) throw new Error('create');
    const file = join(root, 'chats', chat.id, 'chat.json');
    expect(json(file)).toMatchObject({ schemaVersion: BOT_SCHEMA_VERSION.chat, version: 1 });
    const { schemaVersion: _, ...legacy } = json(file);
    put(file, legacy);
    expect(new BotChatStore(join(root, 'chats')).get(chat.id)).toEqual(chat);
    put(file, { ...legacy, schemaVersion: BOT_SCHEMA_VERSION.chat + 1 });
    expect(new BotChatStore(join(root, 'chats')).get(chat.id)).toBeUndefined();
  });

  it('routines.json: stamps the file, reads legacy files, ignores newer schemas', () => {
    const store = new BotRoutineStore(join(root, 'bots'));
    const saved = store.save(A, { title: 't', prompt: 'p', schedule: '0 9 * * *', chatId: CHAT });
    if (!saved.ok) throw new Error('save');
    const file = join(root, 'bots', A, 'routines.json');
    expect(json(file)).toMatchObject({ schemaVersion: BOT_SCHEMA_VERSION.routines });
    put(file, { routines: json(file).routines });
    expect(store.list(A)).toEqual([saved.routine]);
    put(file, { schemaVersion: BOT_SCHEMA_VERSION.routines + 1, routines: json(file).routines });
    expect(store.list(A)).toEqual([]);
  });

  it('delegations.jsonl: stamps lines and keeps newer-schema lines through compaction', () => {
    const file = join(root, 'delegations.jsonl');
    const record = {
      id: D1,
      parentConversationId: 'p',
      parentBotId: A,
      targetBotId: B,
      chatId: null,
      task: 't',
      context: '',
      childConversationId: 'c',
      state: 'running' as const,
      depth: 1,
      createdAt: 1,
    };
    const future = JSON.stringify({
      ...record,
      id: D2,
      schemaVersion: BOT_SCHEMA_VERSION.delegation + 1,
    });
    put(file, `${JSON.stringify(record)}\n${future}\n`);
    const store = new DelegationStore(file, { minRedundant: 1 });
    expect(store.get(D1)).toEqual(record);
    expect(store.get(D2)).toBeUndefined();
    for (let i = 0; i < 4; i++) store.save({ ...record, context: `c${i}` });
    const lines = jsonLines(file);
    expect(lines.some((line) => line.id === D2)).toBe(true);
    expect(lines.filter((line) => line.id === D1).at(-1)).toMatchObject({
      schemaVersion: 1,
      context: 'c3',
    });
  });

  it('tasks.jsonl: stamps snapshots, reads legacy lines, keeps newer-schema lines', () => {
    const store = new GroupTaskStore(root, { minRedundant: 1 });
    const task = store.create(CHAT, { title: 'a', createdBy: 'human' }, 1);
    if (!task) throw new Error('create');
    const file = join(root, CHAT, 'tasks.jsonl');
    expect(jsonLines(file)[0]).toMatchObject({ schemaVersion: 1 });
    const { schemaVersion: _, ...legacy } = jsonLines(file)[0];
    const future = { ...legacy, id: D2, seq: 2, schemaVersion: BOT_SCHEMA_VERSION.task + 1 };
    put(file, `${JSON.stringify(legacy)}\n${JSON.stringify(future)}\n`);
    const reloaded = new GroupTaskStore(root, { minRedundant: 1 });
    expect(reloaded.list(CHAT)).toEqual([task]);
    for (let i = 0; i < 4; i++) reloaded.save(CHAT, { ...task, updatedAt: 2 + i });
    expect(jsonLines(file).some((line) => line.id === D2)).toBe(true);
    expect(reloaded.create(CHAT, { title: 'b', createdBy: 'human' }, 9)?.seq).toBe(3);
  });

  it('卡住：只有带新状态的委派 / 任务写 schemaVersion 2，旧版本当未来记录原样保留', () => {
    const v1Steps: [] = [];
    const file = join(root, 'delegations.jsonl');
    const record = {
      id: D1,
      parentConversationId: 'p',
      parentBotId: A,
      targetBotId: B,
      chatId: null,
      task: 't',
      context: '',
      childConversationId: 'c',
      state: 'running' as const,
      depth: 1,
      createdAt: 1,
    };
    const delegations = new DelegationStore(file);
    delegations.save(record);
    delegations.save({
      ...record,
      id: D2,
      state: 'blocked',
      blocked: { need: '数据库密码', waitFor: 'human', at: 2 },
    });
    const [plain, blocked] = jsonLines(file);
    expect(plain.schemaVersion).toBe(1);
    expect(blocked).toMatchObject({ schemaVersion: 2, state: 'blocked' });
    expect(new DelegationStore(file).get(D2)).toMatchObject({
      state: 'blocked',
      blocked: { need: '数据库密码', waitFor: 'human', at: 2 },
    });
    // 旧版本（第 1 版，无迁移步）：带新状态的行是未来记录，不解析、不改写
    expect(runMigrations(plain, v1Steps)).toEqual(plain);
    expect(runMigrations(blocked, v1Steps)).toBeUndefined();
    // 同一条记录升到第 2 版：立即压缩掉它的第 1 版旧行，免得旧版本按旧行把它当中断改写
    delegations.save({
      ...record,
      state: 'blocked',
      blocked: { need: 'x', waitFor: 'parent', at: 3 },
    });
    expect(jsonLines(file).map((line) => [line.id, line.schemaVersion])).toEqual([
      [D1, 2],
      [D2, 2],
    ]);

    const tasks = new GroupTaskStore(root);
    const task = tasks.create(CHAT, { title: 'a', createdBy: 'human' }, 1)!;
    tasks.save(CHAT, {
      ...task,
      status: 'blocked',
      blockedReason: 'need',
      blockedNeed: '数据库密码',
      blockedStreak: { [B]: 1 },
      updatedAt: 2,
    });
    tasks.save(CHAT, { ...task, status: 'doing', blockedStreak: { [B]: 1 }, updatedAt: 3 });
    const taskFile = join(root, CHAT, 'tasks.jsonl');
    expect(jsonLines(taskFile).map((line) => line.schemaVersion)).toEqual([2, 2]);
    expect(new GroupTaskStore(root).find(CHAT, task.id)).toMatchObject({
      status: 'doing',
      blockedStreak: { [B]: 1 },
    });
    expect(BOT_SCHEMA_VERSION.delegation).toBe(2);
    expect(BOT_SCHEMA_VERSION.task).toBe(2);
    expect(migrateRecord('task', { ...task })).toEqual({ ...task, schemaVersion: 2 });
  });
});
