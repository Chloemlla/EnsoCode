# #44 DeepSeek-Bot：持续成员消息与 #42 委派改造对照

范围：只研究委派相关的会话身份、消息投递、收尾、群接力和长上下文；不盘点插件功能。只新增本文，不覆盖产品 / 技术设计，不改生产代码、不提交、不安装插件、不使用真实 Key。

## 版本与验证边界

| 对象 | 锁定版本 | 用途 |
| --- | --- | --- |
| [DeepSeek-Bot](https://github.com/FeiZhuLulu/DeepSeek-Bot/tree/bdc5fda64e2ea1e83a4d146440072a2413025df4) | `bdc5fda64e2ea1e83a4d146440072a2413025df4`，`ds-bot` 0.1.2 | 插件源码、README、测试 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc) | `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，tag `v0.2.1-alpha.1` | README 声明测试过的宿主；核对 `followup` / inbox / driver 的实现和测试 |
| EnsoCode | 工作树基线 `9eeeefc2eebfd1b785082a4cda6f43d2791fa6bf` | 阅读现有两份未提交设计与竞品研究；不是 #42 已实现版本 |

**日期口径**：本文沿用委派要求的文件名 `2026-10-08-…`，但锁定的上游提交时间为 `2026-10-11T20:40:41+08:00`；这是补充研究，不声称反映 10 月 8 日的历史版本。

下文 `B:` 路径均相对于 DeepSeek-Bot 仓库，`H:` 路径相对于 Harness 仓库，行号对应以上 commit。例如 [B: ds-bot/src/host/delivery.js:26–55](https://github.com/FeiZhuLulu/DeepSeek-Bot/blob/bdc5fda64e2ea1e83a4d146440072a2413025df4/ds-bot/src/host/delivery.js#L26-L55)、[H: packages/core/agent-loop/src/agent.ts:154–169](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/agent-loop/src/agent.ts#L154-L169)。其余证据按同一固定 commit 的路径 / 行号定位。

验证级别：源码核对 + 29 个上游测试和 6 个离线审计测试；测试使用极小 peer adapter，**不是完整 Harness 集成验证**。未运行模型、桌面插件、真实群聊、崩溃恢复或并发压力场景。Harness 的相关测试只读未执行。详见第六节。

## 一、先给结论

1. `message_bot` **向目标成员当前私聊 Session 发异步消息**，不是临时子会话，也不是目标在发起群里的 Session。群里的调用同样默认转到两位成员各自的私聊；它没有 Enso 的 `taskId / run / parentConversationId` 归属。
2. 接收方忙时用 `followup` 排 **next-turn**；所核对 Harness 每轮领取一个 next-turn 消息，不等于 steer，也不等于「同任务追加并入本次执行」。插件返回的 Delivered 表示投递 / flush 已完成，不表示模型开始处理或业务任务完成。
3. 默认回复回发起**成员身份对应的当前私聊**，不是精确发起会话；`reply_to:user` 只在目标私聊答用户。公开群接力是另一路 `group_relay`，顺序等成员回合结束再上墙。
4. 每成员每群独立 Session 的结构属实；但「群永不读取成员私聊」的 README 表述不成立：首次群回合自动附私聊最近消息 brief，群内还能显式 `read_own_chat`。**会话文件隔离 ≠ 输入内容隔离**。
5. 可组合的是「任务 + 多次执行」控制面和「同一范围内持续会话」运行面；不能把「成员唯一私聊收所有委派」拿来替代 #42 的「任务 × 成员子会话」。长上下文只借鉴交接完整性和有范围的历史检索，不替换 pi 权威日志 / 压缩引擎。

## 二、消息究竟进入哪个上下文

### 2.1 身份和路由

`B: ds-bot/src/host/store.js:182–222` 的身份表是：

| 范围 | 映射 / 生命周期 | 隔离效果 |
| --- | --- | --- |
| 成员私聊 | 稳定 `bot.id` → `bot.sessionId`；长会话换段后指向当前段 | 同一成员所有普通 bot-to-bot 请求和用户私聊共用此上下文 |
| 成员群聊 | `room.sessions[botId]`，首次发言创建，之后复用；`groupOwners` 记录 `botId + roomId` | 不同群有不同成员 Session，不直接拼其他群的会话日志 |
| 旧段 | `bot.segments` / `room.segments[botId]` 与 `pastOwners` | 旧段保留，当前指针改变；不是每条消息新建 Session |

`B: ds-bot/src/host/tools.js:61–89` 的 `message_bot` 从 caller 求稳定成员身份，投递时只传 `fromId:sender.id / toId:target.id`，**没有 sourceSessionId、roomId 或 taskId**。`delivery.js:26–55` 默认解析 `sessionId ?? rt.chatOf(toId)`；名为 `senderSessionId` 的 source 字段此处实际装的是稳定成员 id。

因此可以得到这条确定路径：

```text
A 在群 G 的隐藏 Session 调 message_bot(B)
  → B 当前私聊 Session（不创建委派子会话）
  → B turn/end 自动回信
  → A 当前私聊 Session（不是 A 在 G 的 Session）
```

无需把 caller 原始上下文整体复制给 B；工具描述要求消息 self-contained。但 B 会看到自己私聊中既有的其他请求，A 也会在私聊接到来自不同群的回信。这是持续成员消息模型的设计选择，**不满足不同任务、不同群的委派隔离要求**。离线审计覆盖上述路由，见第六节。

### 2.2 独立群 Session 有两个输入例外

- `B: ds-bot/src/host/groups.js:102–123, 213–215`：创建成员群 Session 时调用 `ownChatBrief(member)`，第一次投递把 brief 放在群 prompt 前。
- `B: ds-bot/src/host/chat-index.js:281–291`：brief 从成员私聊最新消息读取（上限由 `OWN_CHAT_BRIEF` 配置常量限定为 10），仅提示模型「private，按需分享」，不是宿主强制脱敏 / 授权。
- `B: ds-bot/src/host/groups.js:314–354`：群成员可以显式 `read_own_chat`，使用被记录为群内 lookup 行；自动 brief 则不走这个显式 lookup 入口。

README `B: ds-bot/README.md:14–21` 的隔离宣传和 `groups.js:311`「私有上下文只通过该工具进入群」注释，均需要以上述实际数据流为准。未验证私人内容会不会真的被模型公开，但**已验证私人文本会进入首次群 prompt**。本项目的跨会话核心记忆另有策略，不能据此推定工作对话可以任意混入。

## 三、忙时消息、送达、去重与收尾

### 3.1 不抢占，正常路径逐条下一轮

`B: ds-bot/src/host/delivery.js:48–54` 调用 `agent.followup(createUserMessage(...))` 后 `sessions.flush`。在所核对宿主：

- `H: packages/core/agent-loop/src/agent.ts:154–169`：followup → `next-turn`；steer → `next-step`；唤醒已运行 driver 不再开第二个 driver。
- `H: packages/core/agent-loop/src/inbox.ts:109–113`：开下一轮时领取全部 next-step + **一个** next-turn。故普通 message_bot 请求按队列逐条开模型回合，不会自动合成一份任务，也没有独立业务 run 记录。
- `H: packages/core/agent-loop/src/agent.ts:214–263, 390–396`：维护中 / 已 abort 的活动会锁存 wake，收敛后重放；回合结束仍有 inbox 则继续下一轮。正常结束边界不是「收到消息就丢掉」。

宿主已有防丢唤醒 / durable inbox 机制，不应把下面插件层的问题说成 Harness 完全没有队列。

### 3.2 Delivered 不是完成回执，也没有 exchange 级幂等

`B: ds-bot/src/host/delivery.js:45–55` 在 resolve / followup 之前记录 request / reply exchange，异步 `save()`；成功返回 exchangeId 是 enqueue + flush 的结果。投递失败可以留下 exchange 记录，**不能只凭 exchanges 推定已送达**。未看到业务层 `accepted → started → settled` 状态或重启后的业务重试协议。

`H: packages/core/agent-loop/src/inbox.ts:28–56` 会拒绝同一 message.id 在 pending 队列重复，但 `delivery.js` 每次 `createUserMessage` 生成新消息；同 exchangeId 重发仍两条消息。离线审计重复调用 deliver(exchangeId='x') 得到两个 followup、两个 exchanges、不同 message.id。不能把 inbox id 校验当委派幂等键。

### 3.3 插件只保留一个回信归属，不是 task/run 收尾协议

`B: ds-bot/src/host/turns.js:138–179, 204–242`：

1. turn/start 从单个 `entry.pending` 取归属；收到第一个 bot source 置 `entry.info`，后续 source 覆盖单个 pending。
2. turn/end 合并本轮 assistant 文本，清空当前 info；request 有文本则按该 source 回信；模型 error 时发失败通知。request 标记 audience=user 不自动回信；中止且无文本的普通请求没有同等完成 / 失败通知分支。
3. 收尾没有按某个任务的 deliveryId 集合等待最后追加回合，也没有当前 run、batch 转移或验收语义。

**条件性风险，非已证实常规生产竞态**：离线事件测试在同一 turn 注入两个 request source，首轮只回第一个；第二个留 pending，下一轮若是无关人类消息，其答案会回给第二个发件人。正常 message_bot 的 next-turn 每次只领取一个，规避了这个合并输入前提；只有实际路径发生同轮多 source（混用 steer、插件变更、转段携带等）才相关，本文未证实转段必然触发。它证明的是单槽归属设计不能直接承接 #42「追加 / deferred 多轮仍归一次执行」。

## 四、回复出口、并发与循环硬限制

### 4.1 两条出口不能混为一谈

| 调用 | 回复出口 | 等待行为 |
| --- | --- | --- |
| `message_bot` 默认 | 接收方 turn/end → 发起成员当前私聊；不是群公开行 | 工具只等投递 flush，返回「later，do not wait」；发起 bot 可以结束当前轮，不会为等待结果维持一个同步 wait 工具 |
| `message_bot(reply_to:user)` | 目标私聊显示给用户，发起方不获自动回信 | 同上；不是目标在发起群里答用户 |
| `group_relay` | 逐位成员私有群 Session → 群 log；先上墙再叫下一位 | root Session 的 relay 工具一直 await runRound / roomTurn，不是释放活动状态的 blocked/yield |

依据：`B: ds-bot/src/host/tools.js:61–89`、`turns.js:204–242`、`groups.js:158–248, 250–308`。message_bot 请求 / 回信轮次被隐藏或简化展示不代表退出模型上下文（`turns.js` 的 exchange 标记和 `parts.js:852` 之后的展示过滤）。

群 root 并非真正调用 Main Bot 模型派活：`B: ds-bot/src/host/groups.js:418–443` 拦截其普通 llm/stream，合成只调 group_relay 的工具调用。**可确认：异步消息没有同步占住主 bot 等结果；群 relay 等待时 root 仍是 active 工具回合，但一般不额外跑 root 模型。不可确认：全宿主 provider 并发配额的实际占用。** 未运行真实 Harness，不把它等同于 Enso 的全局 4 slot 或 #42 blocked 后释放 slot。

### 4.2 系统有硬限制，但并非任意 bot 请求链都被限制

- 自己给自己发 message_bot 被代码拒绝；`MAX_HOPS=6`（`B: ds-bot/src/host/constants.js:23`、`tools.js:80–84`）。但 request 转发**原样传 hop**，自动 reply 才 +1（`turns.js:231, 240`）。所以这是部分消息往返护栏，不是完整的 request 深度限制 / 全局环路检测。审计从 hop=0 连续发 8 次 request 仍为 0；hop=6 才被拒绝。
- 群内回合：总轮次最多「初始 slots 数 +4 +（有 admin 时再 +4）」；被普通成员点名最多答 2 次、被 admin 点名最多答 4 次（`B: ds-bot/src/host/groups.js:23–28, 186–248`）。不要误读为 admin 本人必然最多 4 次，而是取决于**发起点名者**。
- Bot 主动发群贴最多 3 个 rounds，真人新消息重置；群最多 12 成员（`B: ds-bot/src/host/constants.js:36, 51`、`tools.js:287–329`、`groups.js:274`）。
- 等某位成员回复最多 4 分钟（`constants.js` 的 `ROOM_REPLY_TIMEOUT_MS`，`groups.js:158–184`）；超时清 waiter、跳过成员，**不 abort 其运行**。晚来的结果已无 waiter，不能宣称超时等价停止执行。

结论：群 @ 顺序接力确有确定性预算；不能用提示词「不要等待 / 停止循环」加 MAX_HOPS 的存在，推导出委派深度、成本、所有失败必回信或空转次数的完整硬保证。

## 五、长会话继续与旧内容检索

### 5.1 checkpoint 和 handoff 是两种不同继续方式

`B: ds-bot/src/host/steward.js:12–27`：按模型 usable window（扣除输出 reserve 并设下限）默认 80% 检查、95% hard line；窗口缺失用 500,000。`parts.js:478–545, 821–844` 的额外 steward 调用读取近期对话，选择仍未完工 compact，或到停止点 switch；不是任务执行完结判定器。

| 机制 | 状态变化 | 继续时输入 / 失败边界 |
| --- | --- | --- |
| checkpoint | 同一个 Session，调用 backend compact，替换模型工作上下文 | 摘要 + 预算内近期入站消息原文；并读取 backend summary 外保留尾部。源完整记录仍可检索，不能说所有历史都逐字留在窗口里（`parts.js:409–457, 511–545`） |
| handoff / 新 part | 新建 Session，更新私聊或 `room.sessions[botId]` 指针，旧段入 segments 并归档 | 模型写交接 note + 按预算带近期 / 较早输入；模型、权限重新应用；保留 source/exchange，迁移旧 inbox 的 nextStep、nextTurn（`parts.js:300–387, 574–579, 649–753`） |
| 旧段收到新输入 / overflow | pre-step 拒绝旧段执行并 forward；超窗转段 resume | switch carry 中的 claimed 输入也带过去；未完本轮由新段续答；原段 switched 不回重复结果（`parts.js:756–817`、`turns.js:208–220`） |

维护切换先 `whenIdle` 后 `runMaintenance`，期间到达的输入等待 / 携带；无待续任务的 bare handoff 只生成确定性 ack，不再调用模型（`parts.js:649–667, 850–866`）。低于 hard line 且 note 写失败留在原段冷却重试；高于 hard / overflow 可携上次 note 或 fallback，明确可能失去新细节（`parts.js:685–713`）。这些是继续策略，不是崩溃一致性已获验证的事务协议。

它会包装 / 接管 DSH compaction 方法（`parts.js:157–215`）。这层依赖其后端内部契约，**不应移植进 Enso 替换 pi**。借鉴点是「保住未回答输入及结果归属、交接注明遗漏、先限定范围再检索」，不是新造 steward / Session 存储。

### 5.2 检索比把所有旧记录塞回 prompt 更合适，但范围不同

- `B: ds-bot/src/host/chat-index.js:1–39, 48–64, 133–185`：日志派生 SQLite FTS5 trigram，短词走 LIKE，按 session 增量更新；索引可重建，失败回退日志扫描，不是对话权威源。
- `chat-index.js:195–259`：`read_own_chat` 仅限定到该成员私聊的 parts；按词查、读某段 note，或用 `part N #seq` 锚点取原消息周边，长消息仍有限长（目标上限 8,000 字符，周边各 6 条）。
- `B: ds-bot/src/host/groups.js:359–376`：`read_group_chat` 读当前群最近至多 30 条（群 log 保留 60 条），**不是全部历史群 parts 的全文检索**；群里 `read_own_chat` 查的是私聊，不是自己所有群会话。

因此 README 的「旧内容可搜索」主要对私聊成立。#42 若以后做任务旧上下文检索，必须按 task / chat / conversation authority 收窄，不能仿它按稳定 botId 查所有委派工作。当前技术稿第二节明确继续用 pi 压缩，可保留不变；不因为本研究把历史检索立成 #42 必做工程。

## 六、测试证据与复现

环境：Node `v24.14.0`。临时 checkout 为 `/private/tmp/deepseek-bot-5619c5`，Harness 为 `/private/tmp/deepseek-harness-5619c5`。先按上游 `test/harness-resolve.mjs` 运行四组测试：3 个文件因 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-llm` 载入失败，纯 steward 9 个通过。**这是缺依赖，不是产品测试失败，也不是完整测试通过。** 原始输出 `/private/tmp/deepseek-bot-5619c5-test-attempt.log`。

未安装依赖；离线 adapter 只替换两个 peer：`defineTool` 返回原定义、`createUserMessage` 加随机 UUID、`BlockAssembler` 构造直接抛错禁止 LLM。其余被测函数来自锁定 commit。该 adapter 不实现 Harness 调度 / 持久化，故结果只能证明下列插件纯逻辑与事件处理。

```sh
cd /private/tmp/deepseek-bot-5619c5
node --import ./audit-peer-loader.mjs --test \
  ds-bot/test/groups.test.js ds-bot/test/history.test.js \
  ds-bot/test/diagnostics.test.js ds-bot/test/steward.test.js audit.test.mjs
# tests 35; pass 35; fail 0
```

| 测试 | 证据 / 实际覆盖 |
| --- | --- |
| 上游 groups 3 个 | `B: ds-bot/test/groups.test.js`：@ 名称 / 顺序、PASS、去本人名字前缀；**不覆盖真实顺序接力调度** |
| 上游 history 7 个 | `B: ds-bot/test/history.test.js:19–40` 等：historyEntry 的过滤、关键词 SQL / LIKE、问题卡片、note heading；**不等于整库重建及跨群安全已验证** |
| 上游 diagnostics 10 个 | `B: ds-bot/test/diagnostics.test.js:136–166` 等：模型错误给 message_bot 发件人通知、群 waiter 失败 / 中止；另有脱敏 / 诊断测试 |
| 上游 steward 9 个 | `B: ds-bot/test/steward.test.js:65–107` 等：阈值、解析 decision、预算裁剪、checkpoint 识别、保留入站原文、未答请求记 remaining |
| 审计 6 个 | 下列 A1–A6；使用真实 install 函数，mock runtime / session events |

审计输入与断言（可按此重建；临时文件不是仓库正式回归测试）：

| 编号 | 最小输入序列 | 断言 |
| --- | --- | --- |
| A1 | caller `group-a` 映射稳定 bot `a`，message_bot(to=B)，让 B 完成一轮 | 首条 followup 到 `private-b`；reply 到 `private-a`，source 不是群 Session |
| A2 | 同一个 deliver 参数带 `exchangeId=x` 调两次 | 两个 followup、两个 exchanges、不同 message.id，不幂等 |
| A3 | B turn/start → 两条 request source(x1 from A、x2 from C) → 答案 → turn/end；随后人类新轮答另一件事 | 首答回 x1；无关次轮答回 x2；**人为构造同轮双 source，不声称正常 FIFO 必然出现** |
| A4 | live.info.hop=0，连续 8 次 message_bot；再改 hop=6 调一次 | 前 8 个 request.hop 都是 0；第 9 个拒绝，证明不累计 request 深度 |
| A5 | request source audience=user → assistant reply → turn/end | 自动回信次数为 0 |
| A6 | G1 连续两次 relay 点名 B，再 G2 点名 B；ownChatBrief 放固定 private marker | G1 复用同一个 Session，G2 不同；两个群首次 prompt 含 private marker，G1 第二次不重新附 brief |

审计输出：`/private/tmp/deepseek-bot-5619c5-audit.log`；另外复跑同一命令也是 35/35。临时文件 SHA-256：

```text
audit-peer-loader.mjs 268824944b9e4b19e36d42c0cb052e8549a71a284caf019d1dfdaf33a7a233cf
audit.test.mjs        271f7afe9046d7131711dbedf085365ed541e673476cbef5ffcffb8d7f362a8d
```

宿主测试只读证据：`H: packages/core/agent-loop/tests/loop.spec.ts:401–421, 452–480, 1131–1162` 覆盖维护时输入唤醒、事件顺序、收尾 steer；`packages/core/agent-loop/tests/inbox.spec.ts:125–150` 覆盖 pending message.id 重复。上游 `B: ds-bot/dev/smoke.mjs:184–192, 209–220, 232–266` 包含消息往返、群与换段 / 检索 / checkpoint smoke，本文**没有执行**。

尚未验证：真实模型读 brief 后公开私人内容的概率、消息异常中止的实际用户表现、维护 / 转段输入碰撞、重启恢复后回复归属、完整 Harness 的全局并发成本。不能用 35 个离线 PASS 为这些背书。

## 七、和 Multica、现有两份设计怎么组合

Multica 口径沿用 [既有竞品研究](2026-10-06-bot-competitor-research.md) 第二节⑤（本次未另行验证 Multica 源码）。产品稿 [#40](2026-10-08-delegation-redesign.md) 第二 / 四节区分任务和执行；技术稿 [#41](2026-10-08-delegation-redesign-tech.md) 第一至四节已提出 sessions、same-parent 追加、busy 延迟结算、blocked 释放。下表是对照，不覆盖原稿分歧的裁决。

| 维度 | Multica / #40–#41 | DeepSeek-Bot | 组合 / 冲突 |
| --- | --- | --- | --- |
| 身份 | 任务是长期业务主体；Delegation 是一次执行；同任务同成员持续子会话 | 成员身份长期；普通 bot 消息共用成员当前私聊；群另建成员 Session | 能组合「任务管状态、会话承上下文」；不能用 botId 唯一 Session 替代 task-scoped sessions |
| 追加 | 同 parentConversationId + taskId + member，steer 并入执行，只回一次 | followup 下一轮；每次 request 各有 exchange，通常各回一次 | 可复用持久 inbox 思路，不能复用工具语义和单槽 reply 归属 |
| blocked / 验收 | blocked 正式终态，释放执行 slot；交付不等于任务完成 | 消息回合结束只有回复，没有任务 blocked / review 门 | 持续 Session 不必等同持续运行；不能把「等以后回信」当正式 blocked |
| 回信 | parentConversationId / chatId / batchId 绑定结果，公开进度由 Main 写 | 稳定 sender bot → 当前私聊；群 relay 单独上墙 | 长期成员可作为展示身份，不可作为回传唯一地址；跨群串线是明确冲突 |
| 工作区 / 群代际 | #41 第二节检查项目变化、会话失效；群新对话是否保留任务会话仍有待对齐项 | 当前 room + member 管群上下文，不存在 task / run | 每任务 sessions 已在 GroupTask 内，可利用 task 所属群收窄；不能把新对话后的父会话追加到原 run 仅因 bot 相同 |
| 长上下文 | pi 自动压缩，worker/jsonl 权威；不可用时代码拼历次结论 | 自己控制 DSH checkpoint / 新段，并从日志派生检索 | 保留 pi；可以借「摘要不是历史原文、迁移保住未答请求与 source」作为验收标准，不复制引擎 |

推荐关系是三层而不是选边：**任务层（task 的归属与验收）→ 执行层（Delegation / startedAt / 状态 / 收尾）→ 会话层（task × member 的上下文与 pi 日志）**。成员私聊、群发言 Session、任务子会话是不同用途，不能因为都是同一位 Bot 就合并。

## 八、最多三条纳入 #42 的建议

1. **把会话隔离键写成可验收契约，而不是新增第四套实体。** 沿用 #41 `GroupTask.sessions[botId]`，Main 用任务所属群 / 根 chat + taskId + botId 推导，不接受调用方任意 conversation 路径；跨 task / 群绝不复用，同 task 同 member 可续。追加仍要求同 parentConversationId；项目 / authority 失效走既定新会话摘要降级。测试矩阵包含两群同名 / 同序号任务、同成员不同任务、群新对话后的父会话切换、子会话不可用；禁止自动把私聊 brief 或无关工作会话塞入任务。**风险**：只按展示 `#N` 或 botId 建缓存，会把不同群的任务混在一起；反过来过度隔离会丢返工上下文。所属群与 task 实际 id 必须来自权威记录。
2. **把 #41 P3 的送达及结算锁到 delivery → 当前 run，而非只凭忙状态或成员身份。** 保留现有 worker 回执 / pi 协议，不仿 message_bot 单个 pending；`deliveryId` 去重、accepted/deferred/failed 区分清楚，结果回精确 parentConversationId + batch。在现有「busy 就不结算」之外测试 queued 追加、收尾 deferred 下一轮、重复投递、终态后追加、换批次 keep/取消、重启及权限释放边界；归属仍未完成的追加不能被某次 turn/end 提前结算，已失败追加也不能让执行永远 busy。**风险**：裸 busy 是瞬时观测且不是业务归属，迟到消息可漏结果 / 错回一次；batch 接管还能取消错执行。这里是原 P3 的验收补强，不新造 DSH inbox / worker 协议。
3. **把继续会话的验收扩展到「未答内容及身份不丢」，历史索引若做只能是受限派生。** #41 P2 的续跑 / 摘要降级带任务、当前 run、未答问题、待回传请求及最新要求；缺摘要 / 截断明确标注，不能以旧摘要充当已验收结果。pi/jsonl 仍权威，索引只是按允许的 task / chat / conversation 链定位原文，可删可重建；不接管 pi 自动压缩，不引入默认 steward 调用或全 bot 检索。**风险**：模型摘要会遗漏细节和验收证据，跨任务检索会泄露上下文；完整旧历史检索尚无集成证据，可留后续，#42 本次至少测同任务跨压缩 / 新执行仍能正确归属且不借旧工具输出通过本次验收。

不纳入：插件安装、模型 / memory / browser 产品功能、外部渠道、全员唤醒、自动自由讨论、DSH 引擎替换，以及改变 #40 / #41 尚待林经理裁决的既有分歧。
