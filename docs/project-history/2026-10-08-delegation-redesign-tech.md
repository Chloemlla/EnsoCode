# #41 委派改造技术方案：以看板任务为主体、会话延续、追加插入、卡住、公开进度

状态：只读调研 + 技术方案，未改生产代码、未提交。产品设计见 Anran #40 `2026-10-08-delegation-redesign.md`（下称「#40」），本文第八节逐条回答 #40 第九节，第九节列出两份文档待林经理对齐的分歧。参照 `2026-10-06-bot-competitor-research.md` 第⑤节 Multica。原 #39 并入第三节。

基线：`origin/main` d1f6deb22。行号均为该版本。

## 结论先说

1. **不新造「执行」实体，`Delegation` 记录就是一次执行（run）。** 看板任务从「挂一个 `delegationId`」改为「`delegationId` 指当前执行 + `runs` 摘要列表 + 每位成员的子会话 `sessions`」。群聊里没给 `taskId` 时由 Main 自动建卡。`delegate` 工具 schema 不变，只改描述和返回值。
2. **能复用子会话。** 现有「续跑」就在复用：`resume` 沿用原子会话（`delegationService.ts:228`、`:320`），`onTurnFinished` 按 `childConversationId` 找当前活跃记录（`:119`）。委派结束后子会话不会被结束或删除，jsonl 一直在。需要补三处：会话绑定的 `delegationId` 固定为第一次执行；worker 里活实例的工具和权限在 spawn 时就定死了；验收的起算时间。会话不可用时，开新会话并带上历次执行的结论摘要，摘要由代码拼，不调模型。
3. **追加插入复用宿主现有 steer 通道**，即 `deliverConversation` 不带 `queueIfBusy` 时走 `steer()`（`botSessionHost.ts:909-918`），有 worker 回执，不走 #28 的 `interjectQueued`。追加不新建记录，结果仍由原记录回一次；期限取两者到期时刻的较晚者。
4. **「卡住」是新工具 `report_blocked`，只挂在委派子会话里；`blocked` 是新的执行终态 + 新的任务状态。** 工具只做登记，本轮由模型自然结束，结束时 Main 记为 `blocked`。轮次结束会释放并发名额，计时器也随之清掉。解除就是同成员、同任务、同子会话再开一次执行。
5. **公开进度由 Main 写，成员不调工具。** 新增时间线条目 `kind:'progress'`，按成员身份渲染。群路由只由 `human` 条目和 `bot` 回合结束触发，智能选人只读 `human`/`bot`，新条目天然不触发选人和接力。
6. **手机最少改 3 处协议类型**：`PairGroupEntry` 加 `progress`，`PairDelegationState` 加 `blocked`，收件箱加 `task-blocked`。旧手机遇到不认识的条目不渲染，不会崩。
7. 必做 5 期（P1–P5），另有 1 期可选（P6）。Main 和共享层约 9 人日，前端约 5.5 人日（欧阳可并行），最后用 1 天做两家厂商模型和手机实测。

## 现状（证据）

| 事实 | 位置 |
| --- | --- |
| 执行状态只有 `queued/running/completed/failed/canceled`，失败原因 `interrupted/timeout/denied/error/check` | `src/shared/types/bot.ts:107`、`:138` |
| 任务只挂一个 `delegationId`；任务状态 `todo/doing/review/done/canceled` | `bot.ts:796-818`（`:804`）、`:789` |
| 委派 → 任务的纯状态机：开始 → doing；完成 → review/done；其余 → 退回 todo 并清负责人 | `src/main/services/bots/groupTasks.ts:68` |
| `gate` 拒绝已有 `delegationId` 的任务；`sync` 写 system 行（「X 把 #N 委派给 Y」等） | `groupTasks.ts:405`、`:423` |
| 新建子会话：`createBotConversation(projectId, {botId, chatId:null, delegationId})` | `delegationService.ts:299` |
| 计时只在 queued→running 时开始（#19，36431f11d） | `delegationService.ts:469-483` |
| 子会话没有 `group_tasks`（只给群聊当前会话） | `src/main/ipc/bots.ts:1239-1252`、`src/agent/supervisor.ts:2383-2390` |
| 委派结果按父会话轮次（`batchId`）合并回传，群里经 `groups.runAs` 唤醒群主 | `delegationService.ts:486`、`bots.ts:621-631` |
| 委派终态记录投递 30 天后移入 archive | `delegationStore.ts:33`、`:57` |
| 群路由：只有人类条目进 `begin()`、成员回合结束进 `advance()`；智能选人只取 human/bot | `groupChat.ts` `finished()`/`begin()`；`src/shared/bots/smartRoute.ts:102-106` |
| 未知条目 kind 在解析时丢弃 | `bot.ts:626` |

## 一、数据模型（问题 1）

### 1.1 关联方式

`Delegation` 继续作为执行记录，存在 `delegations.jsonl`，权威源不变。新增字段：

```ts
// bot.ts Delegation 新增
trigger?: 'delegate' | 'append' | 'reply' | 'rework' | 'retry';   // 缺省按 delegate
startedAt?: number;                    // queued→running 时写；#19 计时与耗时都以它为准
blocked?: { need: string; waitFor: 'human' | 'parent'; at: number };
appends?: { at: number; text: string; deliveryId: string; ok?: boolean }[];  // 追加插入记录，上限 20
// DELEGATION_STATES 追加 'blocked'（非活跃终态）
```

`GroupTask` 新增字段：

```ts
status: ... | 'blocked'                 // GROUP_TASK_STATUSES 追加
delegationId?: string;                  // 语义改为「当前 / 最近一次执行」，保留以兼容
runs?: GroupTaskRun[];                  // 摘要，最多 30 条，旧的丢弃；不依赖 30 天 archive
sessions?: Record<BotId, string>;       // 成员 → 该任务的子会话，用于延续
blockedNeed?: string; blockedStreak?: number;   // 交付后清零
interface GroupTaskRun { id; botId; trigger; state; startedAt?; finishedAt?; appends?: number }
```

`runs` 摘要由 `GroupTaskService.sync(record)`（`groupTasks.ts:423`）在每次委派落盘时写入。它本来就在 `DelegationService.save`（`delegationService.ts:665`）里同步调用，不需要新增同步点。

### 1.2 没给 taskId 时自动建卡

- 位置：`DelegationService.delegate()` 校验 `taskId` 的分支（`delegationService.ts:216`）之前。条件是 `chat?.kind === 'group' && depth === 1 && !options.resume`。
- 标题：取 `task` 首行截到 60 字，`detail` 取全文前 4000 字（`GROUP_TASK_TEXT_MAX`），`createdBy = parent.id`。不调模型。
- 同一轮批量派给 N 人时每人建一张卡（与 #40 第九节第 7 条的建议一致）。
- 私聊委派（`chatId` 为 null 或私聊）保持现状，不建卡。深度 2 的嵌套委派不建卡，只在上层任务的 `runs` 里记一行（`botId` 为孙级成员），对应 #40 第九节第 9 条。
- 建卡和委派是两次写入：委派被策略拒绝时要回滚，把刚建的卡删掉（`remove`）。所以建卡要放在 `delegationPolicy` 通过之后、`save(record)` 之前。

### 1.3 对调用方和 schema 的影响

| 调用方 | 影响 |
| --- | --- |
| `delegate` 工具（`src/agent/tools/delegation.ts`） | 参数 schema 不变，`taskId` 仍可选，`normalizeDelegationParams` 不动，没有模型兼容风险。描述补一句「群里不带 taskId 会自动建卡；同任务同成员会接着上次的会话」。返回值从 `{ok, delegationId, warning?}` 扩为 `{ok, delegationId, taskId:'#N', merged?: true, delivery?: 'steered'|'queued'}` |
| Main 入口 `agent.ts:1233-1252` | 字段收窄不变，返回值透传。合并路径要等 steer 回执，`service.delegate` 可以返回 Promise，入口已有 `Promise.resolve(result)` |
| `group_tasks`（`groupTasks.ts:472`、`src/agent/tools/groupTasks.ts`） | `list` 多出 `blocked` 状态、`need`、`runs` 次数。`claim` 不允许认领 `blocked`。`complete`/`cancel` 遇到 `delegationId` 的限制改为看当前执行是否活跃或卡住。不加新 action，解除卡住走 `delegate` |
| `gate()`（`groupTasks.ts:405`） | 改为返回 `{taskId, check, mode}`：`fresh` 新执行；`append` 命中同发起会话、同成员的活跃执行；`continue` 任务为 `blocked` 或 `review`，且目标是原执行人。别人的活跃执行仍拒绝 |
| `taskAfterDelegation`（`groupTasks.ts:68`） | 增加 `blocked` 分支：任务 → `blocked`，保留负责人和 `delegationId`，写 `blockedNeed`。其余分支保持不变，#21 的 review 规则不动 |
| `retry()`（`delegationService.ts:379`） | 不变，新记录写 `trigger:'retry'` |
| renderer `stores/bots/delegations.ts`、`DelegationCard.tsx`、`GroupBoard.tsx` | 加 `blocked` 文案；任务卡展示 `runs` |

### 1.4 旧数据兼容

- 旧任务没有 `runs`：任务卡打开时从 `delegationStore.list(chatId)` 按 `taskId` 只读派生，30 天内的记录都还在。超过 30 天就只显示当前那一条，可接受。
- 旧任务没有 `sessions`：延续时回退到「该任务 + 该成员最近一条 Delegation 的 `childConversationId`」，会话文件存在才用。
- 新状态 `blocked` 会让旧版本读不懂（`parseDelegation` 和 `parseGroupTask` 都会拒绝）。做法：只给带新状态的记录写 `schemaVersion: 2`，在 `src/shared/bots/migrations.ts` 的 `task` 和 `delegation` 下各加一步空迁移。旧版本把这些记录当未来记录，压缩时原样保留（`isFutureRecord`），不会被重写掉。降级后这些卡看不见，但不丢数据。这比 #21 的 `review` 做得好：`review` 降级时会被跳过，并可能在压缩时丢失。

## 二、会话延续（问题 2）

### 2.1 能复用的依据

- 委派结束后子会话**不会**被结束：`retireSession`（`botSessionHost.ts:2002`）只由群/私聊换会话、删聊天、删成员调用。委派子会话的 `lifecycle` 一直是 `draft/ready`，jsonl 留着。
- 已有复用路径：`retry` 续跑沿用原 `childConversationId`（`delegationService.ts:379` → `:228` → `:320`），重启后由 `registerDelegation`（`botSessionHost.ts:350`）以 `resumeFile` 重新 spawn。
- 回合结算按 `childConversationId + 活跃` 找记录（`delegationService.ts:119`），同一子会话先后挂多条执行记录不会串。

### 2.2 需要补的限制

| 限制 | 位置 | 处理 |
| --- | --- | --- |
| 会话绑定的 `delegationId` 固定为第一次执行；`upstreamBots`、嵌套委派的祖先、`deliverPending` 里的嵌套父会话都按它查 | `delegationService.ts:147`、`:179`、`:509` | 新增 `executionOf(childConversationId)`：取该子会话最新一条记录，三处改用它。不改 authority 绑定，也不加 IPC |
| worker 里的活实例在 spawn 时定死了工具和权限；`syncEngine` 只同步模型 | `botSessionHost.ts:1487`、`:411-436` | 新执行的 `effectivePermissions` 与上次不同时（审批档取更严、成员改了工具或技能），先在宿主释放空闲实例，下次 `start` 再按 `resumeFile` 重新 spawn。宿主新增 `releaseIdle(conversationId)`（只在 `!isBusy` 时调 `runtime.release`），不能用 `abortConversation`，它会推进 epoch，还会走停止语义 |
| 验收起算时间：`startedAt(record)` 沿 `retryOf` 链回溯到同一子会话的第一条 | `delegationService.ts:610` | 返工和追加是新记录，不挂 `retryOf`，所以不会回溯到上一次执行。注意以后不要给返工挂 `retryOf`，否则上一次执行里的通过输出会被误算为本次验收证据。补单测锁住 |
| 子会话的项目固定在创建时 | `delegationService.ts:228` | 父会话的 `projectId` 和子会话不同（群改过工作区）时不复用，开新会话并带摘要 |
| 上下文变长 | pi 自动压缩 | 沿用现有压缩策略，不另做。验收只看本次执行开始后的工具结果（`taskCheck.ts` `checkPassed(since)`）。执行中途触发压缩导致早期工具结果被摘要的风险，现在就存在，不因本次改造变大 |
| 委派结束后活实例一直留在 worker，直到 worker 退出 | `release()` 只放 slot（`botSessionHost.ts:1654`） | 现有行为。复用后实例数按「任务 × 成员」计，不会增加。可顺手在执行结束且空闲 N 分钟后 `releaseIdle`，不在本次范围 |
| 用户删聊天或成员、私聊回退、群「新对话」 | `discardChat`、`discardRewound`、`startOver`（`delegationService.ts:436`） | 会话被删就不复用。「新对话」只取消活跃执行，任务和会话保留，之后返工仍接着原会话（任务上下文属于任务，不属于群的一轮对话；待对齐第 5 条） |

### 2.3 不能复用时的替代

开新子会话，在 `<delegation-task>` 里附 `<previous-runs>`：每次执行一段，内容是触发来源、执行人、结果或卡住原因的前 600 字、退回理由、人的回复，总长不超过 4000 字。由代码拼接，不调模型。改派给其他成员时也用这段（对应 #40「退回并改派」）。

### 2.4 新执行的投递文本

复用会话时不重复整段任务，只发增量：

```xml
<delegation-task id="新执行id" from="林经理" task="#42" run="3" trigger="rework|reply|append">
退回理由 / 人的回复 / 追加内容
<acceptance-check>…</acceptance-check>
</delegation-task>
```

## 三、追加插入（问题 3，原 #39）

**判定**（`gate` 返回 `append`）：同一个 `parentConversationId`（不只是同一个 `parentBotId`），同 `taskId`、同目标，目标执行的状态是 `queued` 或 `running`。群主会话换过（新对话后的另一个会话）就不算同一发起方，按 #40 排成下一次执行。

**送达确认**
- `running` 且子会话有活跃回合：调用 `host.deliverConversation(child, text, {deliveryId, source:'bot'})`，不带 `queueIfBusy`，走 `steer()`（`botSessionHost.ts:1288`）。返回 `steered:true` 表示 worker 已确认开始处理；返回 `queued:true` 表示已下发但还没回执。`delegate` 最多等 10 秒，结果写进 `appends[i].ok`，返回给工具 `{merged:true, delivery:'steered'|'queued'}`。
- worker 回 `delivery-deferred`（回合正在收尾）时，宿主会把这条改排成下一轮（`observe` 的 deferred 分支）。**关键边界**：回合结束时 `onTurnFinished` 会先把执行记为完成，排在后面的追加轮就没有归属，结果会丢。规则：`onTurnFinished` 时如果 `host.isBusy(child)`，说明还有本执行的追加或 #28 插话没跑完，这时不结算，等下一次回合结束再结算。子会话只归这个「任务 × 成员」，所以它排队的东西都属于当前执行。
- `queued`（排队还没开工）：同样投递到子会话。宿主在 `turnActive` 为假时直接入队，排在原任务后面，开工后作为下一轮执行，遵守上面的「忙就不结算」规则。

**并发连派**：同一父回合并行调两次 `delegate`。Main 是单线程，`delegate()` 在 `save` 之前都是同步的，第二次一定能看到第一次落盘的 `queued` 记录，于是走 `append`。追加不计入 `delegationPolicy` 的「父会话最多 3 条活跃」（`delegationPolicy.ts`）。

**期限合并（保持 #19）**：每个期限各自按目标成员的上限截断。合并后的到期时刻 = max(旧到期时刻 `startedAt + timeoutMinutes`, 现在 + 新期限)。重算 `timeoutMinutes`，重设计时器。还在 `queued` 的只改 `timeoutMinutes`，开工时照常起算。排队时间仍不计。

**结果只回一次**：追加不建记录，只往原记录的 `appends` 里加一条。原记录的 `batchId` 改为本轮的 turnKey，`keep` 取两次的并集。这样停掉早先那一轮（`stopBatch`，`delegationService.ts:417`）不会误取消已经被追加接管的执行；早先那一批里的其他成员照常回传，这条结果跟着最近一轮回。风险见第十节第 3 条。

**和 #28、#29 的关系**
- #28 `interjectQueued`（`botSessionHost.ts` 约 495-560）只处理「真人在群里排队的消息」，要求成员只有一个活跃委派，并且加「来自群…的插话」前缀。追加是成员发起、目标明确的，不经过群队列，所以不复用这个入口，两条路径互不影响。两者最后都落到同一个子会话的 steer，在模型上下文里能区分（`source:'human'` 会包 `wrapInterjection`）。
- #29 准入（`memberActive`/`hasEarlierTask`/`chatOf`，`botSessionHost.ts:1816-1870`）只对新回合生效。steer 进活跃回合不占新名额、不过分类器，这与现在群里 steer 的语义一致。复用会话开的新执行是新回合，照常过准入；`registerDelegation` 每次执行都会重登 `origins`，跨聊天判定不变。

## 四、卡住（问题 4）

### 4.1 工具

新增工具 `report_blocked({ need: string(1-300), waitFor?: 'human'|'parent' })`，**只挂在委派子会话**：
- `BotSpawnSpec` 加 `delegationTask?: true`（`registerDelegation` 的 spec，`botSessionHost.ts:350`）→ `agentHost.ts:936` 透传为 `botDelegationTask`。在 `agent.ts:1074` 的 spawn 命令和 `:2898`、`:2948` 的校验里加这个键 → `supervisor.ts:2383` 挂载。
- 不放进 `group_tasks`：子会话本来就没有它（#21 已定）。也不给 `delegate` 加参数，含义不同。
- 子会话的指令段（`botPrompt.ts` 委派说明）加一句：缺信息就调 `report_blocked`，写明缺什么，然后用一两句话说明已做到哪里，结束本轮；结果里随口问一句不算卡住（与 #40 一致）。
- 工具 invoke 走现有 `delegation-invoke`（`agent.ts` 约 1220）。Main 收窄后，按子会话找到当前执行（`executionOf`），写 `blocked:{need, waitFor, at}`，返回 `{ok:true, instruction:'Stop now…'}`。执行不活跃或不在群任务里时返回错误。

### 4.2 结束执行、释放名额

- 不在工具里强停回合，否则会走 `stopped` 级联，把这一轮派出的子委派一起取消。由模型自然结束本轮，`onTurnFinished`（`delegationService.ts:119`）看到记录带 `blocked` 时，`finish(record, 'blocked')`：不跑验收，`result` 记最后一条回复。
- 兜底：登记后 5 分钟内回合还没结束，就以 `stopConversation` 收掉，原因记 `blocked`。
- 回合结束时宿主 `release()` 就释放了并发名额。`finish` 清计时器，#19 的计时随本次执行结束。卡住期间不计时；续跑是新执行，从它自己真正开工时重新计时。
- `blocked` 不算活跃（`isActiveDelegation` 不变），所以批次照常回传给发起方：`<delegation-result status="blocked">缺：…</delegation-result>`。群主据此代答或 @人。
- 任务 → `blocked`，负责人和会话保留，`blockedStreak+1`。连续卡住 3 次后不再接受发起方代答，只能人来解除（#40 的护栏，按「任务 × 成员」计，交付后清零）。

### 4.3 和 #21 衔接

`blocked` 不进 review，验收规则不变。卡住后续跑交付时，照 `taskAfterDelegation` 进 review 或 done。卡住期间成员不能 `complete`；人可以直接完成、取消，或改派（→ todo，清负责人，保持现有退回语义）。

### 4.4 谁回复算解除，怎么路由回同一成员

| 来源 | 入口 | 路由 |
| --- | --- | --- |
| 发起方成员 | `delegate(to=同成员, taskId=#N, task=答复)` | `gate` 返回 `continue`，同子会话新执行，`trigger:'reply'` |
| 真人（桌面） | 任务卡回复框 → 新 IPC `BOT_TASK_REPLY {chatId, id, text}`（通道常量、handler、preload 三处同步） | Main 按任务的 `assigneeBotId + sessions` 找子会话，以原 `parentConversationId` 新建执行，`trigger:'reply'`，正文按真人插话包装。原发起会话已失效时，改为群主当前会话（`chats.get(chatId).sessions[bossBotId]`） |
| 真人（群里回复卡住消息） | 需要新增「回复某条」关联：`HumanEntryRefs` 加 `replyTo: entryId`（`bot.ts:247-276`），桌面和手机输入框都要改 | 收到时如果 `replyTo` 指向某个 `progress(blocked)` 条目，这条消息就不进群路由，改走上面的 `BOT_TASK_REPLY` 逻辑。放在第 6 期，是可选项 |
| 其他成员或执行人自己 | — | 拒绝（与 #40 一致） |

人回复触发的新执行，结果仍回给原发起方，经 `deliverGroupResult` 唤醒群主新一轮（现有行为，受 #29 来源聊天约束），群主按 #21 验收。

## 五、公开进度（问题 5）

### 5.1 写在哪一层：Main

新增 `GroupEntry` kind（`bot.ts` 联合类型 + `parseGroupEntry` 的 switch）：

```ts
{ kind: 'progress'; botId; taskId; taskSeq: number; delegationId; phase: 'started'|'blocked'|'delivered'; text }
```

- 由 `GroupTaskService.sync()`（`groupTasks.ts:423`）在这三个转换点写入，替换原来对应的三条 system 行，避免重复。挂接点：开工是 `started()`（`delegationService.ts:469`）落盘后的 sync，卡住和交付是 `finish()` 落盘后的 sync。
- 文案用模板，不调模型。开工写「开工 #42『标题』」（续跑写「接着做 #42」）。卡住写「#42 卡住了，缺：{need}」。交付写「交付 #42：{结果首行，前 120 字}」。成员不需要额外调工具，也不靠模型守约。
- 写到发起这次委派的话题（`record.chatId`），看板仍按根群存。

### 5.2 不刷屏

- 每次执行最多 2 条（开工 + 卡住或交付）。追加、重试中、排队、工具调用都不发。
- #40 提出「60 秒内结束的省掉开工」：开工条目延后 60 秒写；到时执行已结束就不写。可以做，成本是一个计时器。
- 「同一批 3 人以上开工合并成一行」：按 `batchId` 缓冲 2 秒后合并。复杂度一般，放第 6 期，可选。
- 深度 2 的嵌套委派不写进群，只有 `blocked` 例外（#40 第六节）。
- 现有 `delivered()`（`delegationService.ts:643`）结果回传父会话时写的 `kind:'delegation'` 卡片保留，它是给群主的结果卡和审计记录。对挂了任务的执行，卡片默认折叠，免得和「交付」进度重复（待对齐第 6 条）。

### 5.3 不触发选人和接力

- 群路由只由人类条目（`begin()`）和成员回合结束（`advance()`）触发。Main 直接 `appendEntry` 写的 `progress` 不经过这两处，和现在 system、delegation 条目一样。
- 智能选人的历史只取 human/bot（`smartRoute.ts:102-106`），`progress` 天然被排除。
- 文本不解析 @，不是 bot 条目，不计入 `turnsByBot` 和 `hops`。
- 进其他成员上下文：`transcript.ts` 的 `render` 加一个 case，渲染为 `<group-message from="Jason" role="进度">`。也可以只给群主渲染（#40 第九节第 8 条）。建议先全员可见、单行，量很小；嫌吵再收窄。

## 六、手机端最少改动（问题 6）

| 协议 | 位置 | 改动 | 旧手机表现 |
| --- | --- | --- | --- |
| `PairGroupEntry` | `packages/pair/src/protocol.ts:342-366` | 加 `progress` 变体（字段同上） | `GroupChatScreen.tsx:267` 的 switch 没有 default，不渲染、不报错 |
| `PairDelegationState` | `protocol.ts:335` | 加 `'blocked'` | 委派卡文案查不到，显示为空，可接受 |
| `PairBotInboxItem.kind` | `protocol.ts:372-381` | 加 `'task-blocked'`（`text` = 「#42 缺：…」） | `botState.ts:185` 标签显示为空 |
| `PairBotEvent.kind` | 不改 | `tasks` 事件仍不转发（`pairBots.ts:474-483`） | — |

手机端渲染：`GroupChatScreen.tsx` 加 `progress` 行（头像 + 一行）；`botState.ts` 的 `INBOX_LABELS` 和 `DELEGATION_TEXT` 加文案。手机端要部署 PWA（relay 前端），协议向后兼容，不需要强制升级。

#40 第七节提出的「进行中 2 · 卡住 1」状态条和只读任务列表，需要新增请求和响应帧 `bot-tasks-request`/`bot-tasks`，以及 `bot-event` 转发 `tasks`。这超出「最少」的范围，放第 6 期可选。用 `progress` 条目加收件箱已经能看到状态。

## 七、实施分期

每期单独提交、单独验收。验收统一跑 `pnpm typecheck && pnpm lint && pnpm test`。涉及模型自主调用工具的期次（3、4、5）按 AGENTS.md，用两家厂商的模型真机跑一遍。

| 期 | 内容 | 主要文件 | Main/共享 | 前端（欧阳并行） | 风险 |
| --- | --- | --- | --- | --- | --- |
| P1 执行挂任务 | `Delegation.trigger/startedAt`；`GroupTask.runs/sessions`；`sync` 写 runs；群里自动建卡；`delegate` 返回 `taskId`；工具描述；旧数据派生 | `shared/types/bot.ts`、`groupTasks.ts`、`delegationService.ts`、`agent/tools/delegation.ts`、`botPrompt.ts`、`migrations.ts` | 2 | 任务卡「历次执行」列表（谁、来源、状态、耗时、查看过程，复用 `DelegationCard` 的打开会话）：`GroupBoard.tsx`、`stores/bots/groupBoard.ts`，1.5 | 自动建卡让看板变多；建卡和委派的回滚 |
| P2 会话延续 | `gate` 返回 `continue`；复用子会话；`executionOf` 替换三处；权限变化时 `releaseIdle`；不可复用就附 `<previous-runs>`；验收起算单测 | `delegationService.ts`、`botSessionHost.ts`、`groupTasks.ts` | 2 | 查看过程里按执行分隔（「第 N 次执行」分隔线，按记录的 `startedAt` 切），0.5 | 嵌套委派祖先链改动；活实例权限 |
| P3 追加插入（#39） | `gate` 返回 `append`；steer 加回执；`appends`；期限合并；`batchId/keep` 转移；「忙就不结算」 | `delegationService.ts`、`groupTasks.ts`、`agent.ts` | 1.5 | 执行行显示「+N 追加」、委派卡显示「已并入」，0.5 | 回合收尾时 deferred 的边界；跨批次回传 |
| P4 卡住 | `report_blocked` 工具和挂载链；`blocked` 状态（执行和任务）；schemaVersion 2；兜底 5 分钟；`BOT_TASK_REPLY` IPC；连续 3 次护栏；收件箱 `task-blocked`；手机协议的 `blocked` 和 inbox | `agent/tools/*`、`supervisor.ts`、`shared/types/agent.ts`、`agentHost.ts`、`agent.ts`、`delegationService.ts`、`groupTasks.ts`、`shared/bots/inbox.ts`、`ipc.ts`/`preload`、`packages/pair/src/protocol.ts` | 2.5 | 看板「卡住·缺 X」列和角标、任务卡回复框、收件箱卡片、`DelegationCard` 的 blocked；手机 inbox 和委派文案，2 | 模型不调工具或调了不收尾；降级时卡片看不见 |
| P5 公开进度 | `progress` 条目；替换 sync 的三条 system 行；60 秒延后开工；transcript 渲染 | `bot.ts`、`groupTasks.ts`、`delegationService.ts`、`shared/bots/transcript.ts`、`pairBotFrames.ts` | 1 | 桌面 `GroupTimeline.tsx` 进度行（成员头像，点 #N 打开任务卡）；手机 `GroupChatScreen.tsx` 进度行，1 | 时间线变吵 |
| P6 可选 | 群里 `replyTo` 解除卡住；3 人以上开工合并；手机只读任务列表帧 | `bot.ts`、`groupChat.ts`、composer、`protocol.ts`、`pairBots.ts` | 1.5 | 桌面和手机输入框的「回复」，手机任务列表，1.5 | 改群路由入口 |
| 验收 | 实测两厂商模型，加 iPhone 13 上的 PWA：派活、开工、卡住、回复后继续、交付、验收、退回返工、追加 | — | 1 | — | — |

依赖关系：P1 → P2 → P3、P4。P5 只依赖 P1，可以和 P2 并行。前端在每期的共享类型合入后就能开工；P1 的类型可以先单独提交给欧阳用。合计：Main 和共享层 P1–P5 共 9 人日，加验收 1 天为 10 人日，含 P6 为 11.5 人日；前端 P1–P5 共 5.5 人日，含 P6 为 7 人日。

## 八、对 #40 第九节「待技术确认」的回答

1. **会话续接**：可以复用，限制和处理见 2.2。会话被删、工作区变了、项目不一致时，开新会话加摘要（2.3）。只换模型不需要开新会话，宿主会同步模型；权限变了就释放后重新 spawn，仍是同一个会话。压缩沿用 pi 现有策略。
2. **steer 合并**：不复用 #28 通道（它服务于群里排队的真人消息），复用宿主的 steer 和回执（第三节）。只回一次：靠不建新记录、`batchId` 转移；期限取 max 并保持 #19：见第三节。
3. **报卡住**：新工具 `report_blocked`，新增执行终态 `blocked`，不用 `completed` 加标记（否则会走验收，进 review）。成员在委派里仍不能用看板工具。
4. **自动续跑的身份**：发起方记原 `parentConversationId`，失效时改为群主当前会话；`trigger:'reply'`，另记 `repliedBy:'human'`。交付结果按现有方式唤醒群主新一轮，受 #29 来源聊天约束，不会唤醒其他成员。
5. **回复某条**：现在没有关联字段（`HumanEntryRefs` 只有 chats 和 skill，`bot.ts:247-276`）。桌面先只做任务卡回复框（P4），群里回复放 P6；手机端 P4 只能看到卡住，回复放 P6。
6. **系统失败 → 卡住**：技术上可以，在 `taskAfterDelegation` 的失败分支改为 `blocked` 并保留负责人。但这会改变现有「失败回 todo、清负责人」的语义，任务要求保留现有规则，见待对齐第 1 条。
7. **自动建卡**：截首行 60 字，不调模型；批量委派每人一张。
8. **节点消息**：新增 `progress` 条目，不进路由；进上下文的方式见 5.3。
9. **嵌套委派**：只记在上层任务的执行记录里，不建子卡。
10. **手机看板数据**：现有同步拿不到（`pairBots.ts:474-483` 丢弃了 `tasks`），要新加帧，放 P6。
11. **连续卡住计数**：按「任务 × 成员」计，交付后清零。

## 九、与 #40 待对齐（交林经理）

1. **失败是否算「卡住」**：#40 把超时、失败、被拒都算卡住，并保留负责人。用户约束「保留 #19 计时」不受影响，但这会改变 `taskAfterDelegation` 现有的「失败退回待办」。建议：执行状态仍为 `failed`；任务进 `blocked`，原因写「执行失败：超时」，负责人保留；「重试」接着同一个会话跑。需要林经理确认可以改这一处语义。
2. **退回默认给原成员返工**（#40 第四节第 3 点）与 #21「退回一律回待办」不一致。建议保留 #21 的退回，另加一个「退回并返工」按钮或工具参数（`group_tasks reject` 加 `rework:true`），走同会话新执行。这是新增，不改 #21。
3. **待验收时追加**：#40 视同返工（review → doing）。技术上就是 `gate` 的 `continue`，没问题；但同时得说明 #21 的验收人在这之后如何重新验收（交付后回到 review）。
4. **任务卡回复框在「执行中」时立刻插入**：这属于真人 steer，和 #28「点按钮才转入」不同，但不冲突，因为入口不同。需要确认产品上接受。
5. **群「新对话」后返工是否接着原会话**：本文建议接着（任务的上下文属于任务）。#40 没提。
6. **交付时群里会出现两条**：成员的「交付」进度和给群主的委派结果卡。建议挂了任务的委派结果卡默认折叠，或者不写进群，只回群主会话。需要 Anran 定。
7. **60 秒省开工、3 人以上合并开工**：都能做。前者放 P5，后者放 P6 可选。
8. **手机只读任务列表**：不在「最少」范围内，放 P6。
9. **头像「卡住」改名**：本轮另外把静默阈值从 90 秒改成了 5 分钟（见下），#40 文中「90 秒无输出」相应要改。

## 十、风险

1. 模型不调 `report_blocked`，而是在结果里提问：按交付处理进 review，靠验收人退回。这正是 #40 选的做法。两厂商实测时专门测这一点。
2. 调了 `report_blocked` 却不收尾、继续干活：5 分钟兜底停掉。兜底停止的原因要和用户手动停止区分，不能级联取消子委派。
3. 追加转移 `batchId` 后，早先那一轮的批次结果会少一条，群主在早先那一轮看不到这条结果，要等最近一轮。若林经理认为不可接受，备选：保留原 `batchId`，并让追加强制 `keep:true`。
4. 降级（回到旧版本）：`blocked` 记录用 schemaVersion 2 保存，旧版本看不见但不丢。旧版本会把 review 行当坏行跳过，这个风险 #21 已存在。
5. 自动建卡让看板变多：只在群里、只在深度 1 时建；私聊委派不变。
6. `botSessionHost.ts` 是 #28、#29 的共同改动点，P2、P3 都要改它，必须按顺序合入，不能并行。

## 附：本轮顺带修改（不在 #41 范围，用户 seq431 要求直接改）

成员静默提醒（收件箱「已安静 N 秒」，手机经收件箱帧看到）的阈值从 90 秒改为 5 分钟：`src/main/services/bots/botSessionHost.ts:35` `BOT_SILENCE_MS = 5 * 60_000`。新增单测 `botSessionHost.test.ts`「defaults to 5 minutes…」，先失败后通过。原测试显式传 `silenceMs: 90_000`，不受影响。未提交。
