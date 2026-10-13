# #16 竞品调研：开源 Grok Bot / dots 实现、OpenClaw 及同类个人助理（补充 Multica、Cumora、Octop）

状态：调研结论（只读调研，未改生产代码）。资料截至 2026-10-06，来自各项目 README 与官方文档，未运行对方代码；网页内容只作资料。2026-10-06 按用户 seq184 补充 Multica 对照（第二节 ⑤），前 5 条随之重排；同日按用户 seq186 补充 Cumora 对照（第二节 ⑥，读的是仓库 main@6224983 的 README 与 `docs/COORDINATION.md`、`BYOA.md`、`SHIPPING.md`），前 5 条再次重排；同日按用户 seq243 补充 Octop 对照（第二节 ⑦，读的是 Octop main@4b17f1c 的 README、`docs/` 与相关源码，以及其运行时 octop-harness main@14a1cd9 的 tool_guard 实现），前 5 条排序不变，Top 2 补充验收口径。

## 结论先说

1. **用户说的「Grok bot、dot」更可能是两款刚发布的闭源产品**：xAI/Cursor 的 **Grok Bot**（2026-08-11 发布）和 OpenAI 的 **dots**（2026-09-29 发布）。它们都是「一组常驻 AI 同事，有记忆、例行任务和群聊协作」的形态，和我们的 Bot 模式定位最接近。对应的开源实现：
   - Grok Bot → **[Z4YT0N/OpenGrokBot](https://github.com/Z4YT0N/OpenGrokBot)**。README 自称 open-source Grok Bot alternative，Bot 模式设计时已参考过它的分派器和用量统计（见 [`2026-10-03-bot-mode-design.md`](2026-10-03-bot-mode-design.md)「参考结论」）。
   - dots → **[tots](https://tots.family/)**。官网自称 open-source version of Dots，但首页没有源码仓库链接，同页还在推 Solana 代币 $TOTS，文案几乎照搬 OpenAI 的 dots 发布页。**可信度低，不作为实现参考**，只把 dots 本身的公开设计当产品参考。
   - 林经理判断的 Clawdbot / Moltbot（现在叫 **OpenClaw**）也成立：「dot」可能是「Clawdbot」的语音识别残片。OpenClaw 是这一类里最成熟的开源项目，因此按任务要求作为主看对象。
2. **我们 Bot 模式的主干已经覆盖了这类产品的大部分功能**：成员人设、私聊/群聊、@接力加智能选人、委派与验收、群看板、长期记忆与核心笔记、例行任务（草稿审批、补跑）、审批与受保护动作、手机端配对与离线发送、目标式引导、用量预算。差距不在「有没有」，而在**记忆可追溯、触发更省、技能能沉淀、首跑不卡住**这几个细节。
3. **前 5 条借鉴建议**（详见文末）：① 首跑先验证模型再引导，失败按原因直达配置；② 记忆来源追溯，可预览后按对话遗忘；③ 看板任务交还验收与阻塞上报（来自 Multica，补 Cumora「执行者不能自证」）；④ 团队模板改成岗位契约结构，群主加固定派单协议；⑤ 辅助模型调用也入账（来自 Cumora 的 `llm_calls` 账本）。「例行任务前置检查闸门」顺延为第 6，「成员提议技能草稿」顺延为第 7。①② 分别并入既定的「失败恢复闭环」和「记忆导出与恢复预览」两个优先项，不另起一摊。
4. **刻意不做的部分不变**：外部 IM 渠道（Telegram/Slack 等）、入站 Webhook、云端/容器沙箱与远程节点、语音通话与语音唤醒、心跳式无人触发轮次、技能市场。补 Cumora 后再加三项：agent 真实邮箱、云端每 agent 一个 K8s pod、日历时段和对话停滞触发的主动唤醒。理由见各节。
5. **补充对照 Multica**：它是人和 AI agent 组队的工作台，核心是把「任务」和「每次执行」分开、交付先进待审核、阻塞是正式状态。我们的委派、同成员准入、群主兜底已覆盖它大部分派活机制，准入判定还更细；缺的是**交还验收**和**阻塞上报**两道口（新 Top 3），另有失败原因码（并入 Top 1）和群主固定协议（并入 Top 4）可借。顺带发现一个缺陷候选：委派时限从创建起算，排队和等人回答都在计时（见 ⑤ 节）。
6. **补充对照 Cumora**：形态和我们最像（人和 agent 同一成员列表、私聊、群聊、看板，三端，BYOA 跑本地 Claude Code / Codex），但协作模型相反：它每条消息唤醒房间里所有 agent，再靠新鲜度门、原子认领、小模型分诊和一整套限流层防撞车；我们用「单一回复人 + 顺序 @接力 + 智能选人」从结构上避开了大部分撞车，原子认领和小模型挡在前面也已有。真正缺的是**辅助模型调用不入账**（新 Top 5）；另有三个小项：并行回复时给正在跑的成员追加新消息、认领失效提示、可重复跑的群聊协作回归。还有一项**安全待核实**：成员执行的命令是否继承了带密钥的环境变量（见 ⑥ 节）。
7. **补充对照 Octop**（腾讯云，自托管多用户多 Agent，Python）：前 5 条不变。两点重点核实的结论：
   - **用户现在不能自己编辑命令规则**。我们的审批只有档位 +「本会话总是允许」，而且「总是允许」按工具名放行，点一次就放开本会话所有 shell 命令（受保护底线开着时五类动作仍会问）；受保护动作是写死在代码里的分类器，只能整体开关。Octop 的 tool_guard 是可在界面编辑的 YAML 正则黑名单，但默认只记日志、正则很粗，不值得照搬。建议分两步：先把「本会话总是允许」收窄到命令前缀（S，1–1.5 人日，顺手做，不占排序）；持久化的允许 / 需确认 / 禁止规则约 4–5 人日，排第 8，等第一步上线、确认审批疲劳确实存在再做。
   - **memory slim 不能和 Top 2 合并成一项**。它做的是 SQLite 对话检查点的去重和空间回收，文档写明不删历史和业务记忆，和「按来源遗忘错误记忆」不是一个问题；我们的会话权威源是 pi 的 jsonl，也没有这类膨胀，功能本身不做。可借的是它的操作纪律（预览无副作用、确认时重算范围、先备份、结果可查），并入 Top 2 的验收口径；「先备份」用现有的记忆归档 / 恢复实现，不另做文件备份。

## 调研对象与名称判断

| 对象 | 性质 | 本报告用法 |
|---|---|---|
| [Grok Bot](https://x.ai/news/introducing-grok-bot)（xAI/Cursor） | 闭源 SaaS，云端电脑 + 多 Bot 群聊 + 例行任务，9 月推出 [Team Bots](https://x.ai/news/team-bots) | 只作产品参考 |
| [OpenGrokBot](https://github.com/Z4YT0N/OpenGrokBot) | MIT，TypeScript，约 5k 行，本地 Electron/Web/PWA | **对照项目①**（「开源 Grok bot」） |
| [dots](https://openai.com/index/introducing-dots/)（OpenAI） | 闭源，云端电脑，主动研究，自动审查 | 只作产品参考 |
| [tots](https://tots.family/) | 自称开源版 dots，没找到仓库，带代币 | 不采信，只列出 |
| [OpenClaw](https://github.com/openclaw/openclaw)（原 Warelay → CLAWDIS → Clawdbot → Moltbot） | MIT，TS + Swift，Gateway 加 20 多个 IM 渠道和原生 App | **主看对象** |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent)（Nous Research） | MIT，Python，自我改进的学习闭环 | **对照项目②** |
| [NanoClaw](https://github.com/nanocoai/nanoclaw) | 轻量 OpenClaw 替代，每个 agent 一个容器 | **对照项目③** |
| [nanobot](https://github.com/HKUDS/nanobot)（HKUDS） | Python 轻量个人 agent，WebUI，Dream 记忆 | **对照项目④** |
| [Multica](https://github.com/multica-ai/multica)（[文档](https://multica.ai/docs)） | 源码可见、可自建；人 + agent 的 issue 看板，本地 daemon 驱动 26 种 agent CLI | **对照项目⑤**（seq184 补充，重点对照任务板与委派） |
| [Cumora](https://github.com/yetone/cumora) | MIT，TypeScript；人 + agent 团队聊天，Electron / PWA / iOS（Android 未发布），云端 pod 或 BYOA 本地 daemon | **对照项目⑥**（seq186 补充，重点对照群聊协作防撞与 BYOA 边界） |
| [Octop](https://github.com/TencentCloud/Octop)（腾讯云） | MIT，Python + React；自托管单进程，多用户多 Agent，Web 控制台 / 桌面客户端 / CLI / IM | **对照项目⑦**（seq243 补充，重点对照命令护栏和记忆维护） |

改名史见 [Wikipedia: OpenClaw](https://en.wikipedia.org/wiki/OpenClaw)。

## 一、OpenClaw（主看）

**定位**：本机常驻的 Gateway 是控制面，统一管理会话、工具、事件和渠道连接；用户从 WhatsApp、Telegram、Slack、iMessage 等 20 多个渠道，或 Control UI、TUI、原生 App 跟它说话。项目自己的说法是「受信的 Gateway + 不受信的执行 + 确定性策略」。默认一个人一个助理，改配置也能给团队部署。

**架构要点**
- Gateway 单进程，持有全部会话状态，UI 和客户端都只是 Gateway 的客户端。会话按来源路由：私信默认汇入一个**主会话**（`agent:<id>:main`），群和房间各自隔离，定时任务每次运行开新会话。
- **一个 agent = 一个工作区**（`AGENTS.md / SOUL.md / USER.md / MEMORY.md` 等启动文件自动注入）+ 独立状态目录 + SQLite 会话库；渠道账号通过 binding 路由到 agent。
- 模型和 agent 运行时（Claude、Codex、本地模型）都是插件；技能遵循 SKILL.md，按工作区 → 项目 → 个人 → 托管 → Workshop → 内置的顺序决定优先级。

**按维度看巧妙设计**

- **会话与记忆**
  - 记忆就是工作区里的纯 Markdown：`USER.md`（用户偏好，用指令式写法，旧条目原地标记作废而不是追加矛盾内容）、`MEMORY.md`（长期事实）、`memory/YYYY-MM-DD.md`（日记层，只进索引不注入）、`DREAMS.md`（整理日志，给人看）。原则写明「没有隐藏状态」。（[Memory overview](https://docs.openclaw.ai/concepts/memory)）
  - 记忆架构有五条原则：写比检索更难，所以整理放到后台；**写入路径就是安全边界**，靠来源和结构性门槛防污染，不靠事后内容扫描；确定性闸门里才让模型做判断；记忆故障不能吃掉回复。（[Memory architecture](https://docs.openclaw.ai/concepts/memory-architecture)）
  - **Dreaming**：后台按 light → REM → deep 三阶段整理，只有 deep 阶段写 `MEMORY.md`；每条晋升记忆带 trigger 标签和 1–10 的重要度；改写前保存原文以便回滚。（[Dreaming](https://docs.openclaw.ai/concepts/dreaming)）
  - **记忆来源与遗忘**：自动摄取的记忆记录来源会话；`memory forget --session … --dry-run` 先预览会删哪些条目，再执行删除，并把这个会话标为「已遗忘」，防止下次摄取又写回来；多来源条目单独列出。（[Memory provenance](https://docs.openclaw.ai/concepts/memory-provenance)）
  - Active Memory：先做确定性的触发词召回，不够时才起一个只能调用记忆工具的子代理深挖；心跳、后台和子代理轮次不跑。（[How active memory works](https://docs.openclaw.ai/concepts/active-memory/how-it-works)）
  - Standing intents：事件条件式的「前瞻记忆」，比如「有人提到发布清单时提醒我确认回滚负责人」，默认冷却 24 小时、最多触发 3 次、90 天过期。（[Standing intents](https://docs.openclaw.ai/concepts/standing-intents)）
  - 压缩时保证工具调用和结果成对；安全模式下摘要必须保留待回答的问题和精确标识符，校验不过就不写入。（[Compaction](https://docs.openclaw.ai/concepts/compaction)）
  - Session state awareness：有人直接插手子会话、目标变了时，给观察者发**一条合并后的过期提醒**，对方用 `changesSince` 拉增量。（[Session state](https://docs.openclaw.ai/concepts/session-state)）
- **多 agent 与群聊**
  - Broadcast groups：同一条群消息可以让多个 agent 各自回复，有 @ 门控、`maxRounds` 1–4、`maxTurns` 上限，参与者最多 16 个；目前是实验功能。（[Broadcast groups](https://docs.openclaw.ai/channels/broadcast-groups)）
  - Ambient room events：没被 @ 的群消息只当静默上下文，agent 必须显式调用 `message` 工具才会在群里发言，不再依赖回复 `NO_REPLY`。（[Ambient room events](https://docs.openclaw.ai/channels/ambient-room-events)）
  - **Parallel specialist lanes**：把并行看成稀缺资源问题，瓶颈在会话锁、模型容量、工具容量、上下文和归属不清。每条 lane 在 `AGENTS.md` 里写契约：职责、非目标、聊天预算（长任务先简短确认再转后台）、交接规则、工具风险。（[Specialist lanes](https://docs.openclaw.ai/concepts/parallel-specialist-lanes)）
  - 会话工具 `sessions_spawn / sessions_yield / subagents / sessions_send`；跨会话读取返回脱敏、限长的视图，不给原始转写。（[Session tools](https://docs.openclaw.ai/concepts/session-tool)）
- **定时与主动触发**
  - Automations 有 `at / every / cron / on-exit / stream` 五种调度；整点任务自动错开最多 5 分钟；还支持**条件脚本门控**。（[Schedules](https://docs.openclaw.ai/automation/cron-jobs/schedules)）
  - Heartbeat：系统按周期唤醒主会话，「有事才说」，事件唤醒之间至少隔 30 秒，60 秒内超过 5 次触发防洪。（[Heartbeat](https://docs.openclaw.ai/gateway/heartbeat)）
  - Standing orders：在 `AGENTS.md` 里写常设授权，包括范围、触发、审批闸门和升级条件。（[Standing orders](https://docs.openclaw.ai/automation/standing-orders)）
- **技能与插件**：Skill Workshop 让 agent 产出**技能提案**（内容、目标位置、扫描状态、哈希、回滚元数据），应用后才生效；ClawHub 是社区市场，附安全审计。（[Skills](https://docs.openclaw.ai/tools/skills)、[Skill Workshop](https://docs.openclaw.ai/tools/skill-workshop)）
- **移动端配对与语音**
  - 配对分两种：陌生人私信配对（8 位无歧义码，1 小时过期，每个账号最多 3 个待处理）和设备节点配对（二维码加 setup code，令牌可轮换、可吊销）。（[Pairing](https://docs.openclaw.ai/channels/pairing)）
  - iOS：只读离线缓存；**离线发件箱最多 50 条，按顺序幂等重发，离线超过 48 小时就过期不发**；会话分活跃、休眠、归档三类。（[iOS app](https://docs.openclaw.ai/platforms/ios)）
  - Talk 模式（实时语音，含 Apple Watch）、语音唤醒词由 Gateway 统一维护并同步到各端。（[Talk](https://docs.openclaw.ai/nodes/talk)、[Voice wake](https://docs.openclaw.ai/nodes/voicewake)）
- **审批与沙箱**：exec 审批分 allow-once / allow-always / deny 加白名单；沙箱默认关闭，可选 Docker、Podman、SSH、OpenShell 等后端；文档承认沙箱不是完美边界。（[Sandboxing](https://docs.openclaw.ai/gateway/sandboxing)、[Approvals](https://docs.openclaw.ai/cli/approvals)）
- **Onboarding**：**先建立推理**，检测已有的 AI 访问方式，用户选完 provider 后实测一次，只保存能用的路线，再交给内置的「OpenClaw」系统 agent 用对话完成其余配置和修复；`openclaw doctor` 一条命令说明哪里出了问题。（[Onboard](https://docs.openclaw.ai/cli/onboard)、[Setup agent](https://docs.openclaw.ai/cli/openclaw)、[Doctor](https://docs.openclaw.ai/cli/doctor)）

**应避免的地方**：配置面极大（文档有上百页，NanoClaw 作者批评它「近 50 万行、53 个配置文件」）；安全主要在应用层（白名单、配对码），工具默认直接在宿主机执行；渠道一多，提示注入的入口就多。

## 二、对照项目

### ① OpenGrokBot（开源 Grok Bot）

- **核心功能**：内置 10 个岗位员工，带人设、颜色和头像形状；群聊里由分派器挑 1–3 人回复，「帮我做 X」只交给一个人，先做后说；支持 @ 指定人、@everyone、轮次上限、静音和「仅 @ 回复」模式；每个员工可以单独选 Claude Code / Codex / Gemini CLI / 任意 OpenAI 兼容 API；MCP 一键市场；按员工、会话、模型统计 token 和成本；审批卡片（允许一次 / 总是允许 / 拒绝）加按路径的自动审查规则；例行任务支持 cron 预设和 Webhook；附件双向传，并有 HTML/图片预览卡片；每人一份笔记，说完话后由便宜模型重写；`/` 技能；⌘K 搜索、未读、隐藏；群聊可导出 Markdown；员工可导入导出 JSON；可作 PWA 用在手机上。
- **架构要点**：本地 Node 服务加 Electron；Claude、Codex 员工各有每聊天一个可恢复会话，API 员工每轮带最近转写；所有配置在一个 `team.json` 里；提示词经 stdin 传给 CLI，避免 Windows 下非 ASCII 字符出问题。
- **巧妙设计**：「build first, talk second」的分派口径；CLI 订阅直连（不用 API key）；用量页显示 Claude 订阅的额度窗口。
- **对我们**：上一轮已吸收分派器、轮次上限、用量汇总、⌘K 搜索、产物预览。**剩下可借鉴的只有「群聊导出 Markdown」**，可以并进记忆/群导出一起做。Webhook 触发属于刻意不做。

### ② Hermes Agent

- **核心功能**：主打「学习闭环」：复杂任务做完后自动沉淀技能，用的过程中继续改进；会周期性提醒自己保存知识；FTS5 会话检索加 LLM 摘要；用 Honcho 建用户模型；自带 cron，结果投递到各 IM；有子代理并行，也能写 Python 脚本经 RPC 调工具；终端后端有本地、Docker、SSH、Modal、Daytona 等七种；可以从 OpenClaw 迁移（`hermes claw migrate`）。
- **记忆的巧妙设计**：`MEMORY.md` 约 2200 字、`USER.md` 约 1375 字，**会话开始时冻结成快照注入**，有利于前缀缓存；注入块的表头直接写出容量，比如「67% — 1,474/2,200 chars」，让模型知道还剩多少；写满时工具报错，由模型当轮自己合并或删旧条目，**不会静默截断**。（[Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)）
- **技能**：遵循 agentskills.io 标准，渐进加载；从网站一键安装也要过安全扫描和确认对话框。（[Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)）
- **应避免**：agent 可以直接改、删任何技能，没有审批；两个进程共用一个 home 会把记忆搅乱，官方也只是靠文档提醒。

### ③ NanoClaw

- **核心功能**：每个 agent 组有自己的 `CLAUDE.md`、记忆、容器和显式挂载；渠道由技能按需拷进用户的 fork（`/add-telegram`）；**凭据网关**让 agent 拿不到原始 key，出站请求由网关注入凭据并按 agent 限流；Slack 里每个 agent 是一个独立 App。
- **巧妙设计**
  - **定时任务脚本闸门**：运行前先跑一段 Bash（超时 30 秒、输出上限 1MB），最后一行输出 `{"wakeAgent": false}` 就直接结束、不调模型，为 `true` 时把 `data` 拼进提示词。高频巡检的成本因此接近零。每次运行后要求 agent 追加一条工作日志。（[Scheduled tasks](https://github.com/nanocoai/nanoclaw/blob/main/docs/scheduled-tasks.md)）
  - 三档隔离：共享会话、同 agent 分会话、完全独立 agent。（[Isolation model](https://github.com/nanocoai/nanoclaw/blob/main/docs/isolation-model.md)）
  - 安装脚本是确定性流程，某一步失败时交给 Claude Code 诊断，然后从断点继续。
- **应避免**：依赖 Docker，门槛高；「定制就改代码」只适合开发者。

### ④ nanobot

- **核心功能**：WebUI 和 TUI，渠道、MCP、cron、长目标、子代理、OpenAI 兼容 API。首跑直接打开本地 WebUI，在 Settings → Models 里配置；文档给出「三步验证」：选模型 → 发 Hello → 选工作区和权限。（[README](https://github.com/HKUDS/nanobot)）
- **记忆的巧妙设计**：两段式。压缩时把摘要追加进 `history.jsonl`（只追加、带游标）；Dream 按 cron 读新条目，对 `SOUL/USER/MEMORY.md` 做「最小诚实修改」，而不是整篇重写；**GitStore 用 git 记录长期记忆文件的每次变化**，可以查看和回滚。（[Memory](https://github.com/HKUDS/nanobot/blob/main/docs/memory.md)）

### ⑤ Multica（补充对照）

- **定位**：人和 AI coding agent 在同一个 issue 看板上协作。agent 不是常驻进程，只是「身份 + 配置」；每次被显式触发（分配 issue、评论里 @、私聊、Autopilot）生成一条 run，由用户机器上的 daemon 领取，调用本地 CLI（Claude Code、Codex、Pi 等）执行，进度和结果写回 issue。（[README](https://github.com/multica-ai/multica)、[How Multica works](https://multica.ai/docs/how-multica-works)）
- **和 OpenClaw 的区别**：不是个人助理，没有长期记忆层；重心在**工作单元（issue）和执行记录（run）分开**，以及**由人把关的状态流转**。和我们最可比的是群聊任务板、委派和项目经理角色。

**机制拆解**

- **issue 与 run 绑定**：一个 issue 可以有多次 run（首次实现、追加修改、复查、换人），每次单独记录，不覆盖。issue 侧栏的执行日志把进行中的 run 置顶、历史折叠，每行有触发来源、执行者、状态和耗时，可以看转写、停止、重试。**run 完成不等于 issue 完成**，是否完成看 issue 状态。（[Runs](https://multica.ai/docs/tasks)、[Issues](https://multica.ai/docs/issues)）
- **进度回写**：agent 一开始做本 issue 的事就把状态改成 `in_progress`，过程中发评论；页头有「Engineer is working」实时标签；运行中回复会进入当前 run（steer）。状态由 agent 通过 CLI 显式写入，服务端不因 run 开始或结束改状态。例外只有两个：失败且没有其他 run、也没有重试时 `in_progress` 回退为 `todo`；关联 PR 全部合并后转 `done`。（[Assigning issues](https://multica.ai/docs/assigning-issues)）
- **交还审核**：交付就改 `in_review`，`done` 通常由人确认（或 PR 合并）。交还给人后，该 issue 的失败通知自动归档。（[Issues](https://multica.ai/docs/issues)、[Inbox](https://multica.ai/docs/inbox)）
- **阻塞上报**：`blocked` 是正式状态，`agent_blocked` 是正式失败原因，处理建议是「提供它评论里要的东西」。agent 写明缺什么后，本次 run 以 `agent_blocked` 结束；人回复评论，按上下文路由回同一个 agent，新开 run 继续。`blocked` 的失败通知不会自动归档。（[Runs](https://multica.ai/docs/tasks)、[Inbox](https://multica.ai/docs/inbox)、[Mentions](https://multica.ai/docs/mentioning-agents)）
- **Squads（组长分派）**：派给 squad 时只唤醒组长。系统给组长追加一段**不可编辑的操作协议**：读 issue；用名册里的精确 @ 语法派活；不复述需求；每轮用 `squad activity` 记一条判断；**派完即停，自己不实现**；整体目标达成才改 `in_review`，`done` 留给人。成员不带 @ 的进展回帖会重新唤醒组长；组长自己的评论和带显式 @ 的交接不唤醒；同一 issue 已有排队中的 run 时不重复入队。（[Squads](https://multica.ai/docs/squads)）
- **队列与准入**：run 状态有 `deferred / queued / dispatched / waiting_local_directory / running / completed / failed / cancelled`。每个 daemon 默认并发 20，每个 agent 6；本地目录被别的 run 占用时显示 `waiting_local_directory`。同一 agent 在同一 issue 已有排队 run 时，新评论**合并进这条排队的 run**；正在运行时，后续评论等本次结束后合并成一条追加 run。**排队不过期**：runtime 还有心跳就算「忙」而不是「没了」，只有 runtime 失联超过宽限期、且 run 本身也排了这么久，才判失败。运行中的长任务也不按时长强杀，由实际活动判断是否卡住。（[Runs](https://multica.ai/docs/tasks)、[Daemon](https://multica.ai/docs/daemon-runtimes)、[Mentions](https://multica.ai/docs/mentioning-agents)）
- **失败与重试**：只对瞬时基础设施故障自动重试（默认最多 2 次）；鉴权、额度、配置、模型不可用这类错误不自动重试。失败原因分平台侧和工具侧两组，二十多个码，每个码都配了「该做什么」，例如 `provider_quota_limit` 对应「充值或换账号」，`model_not_found_or_unavailable` 对应「去 agent 设置换模型」。（[Runs](https://multica.ai/docs/tasks)）
- **触发预览**：发评论前，输入框下方列出**这条会唤醒谁、为什么**（直接 @ / issue 负责人 / 组长），以及谁因为没有权限或离线不会启动；可以临时取消勾选某人。以 `/note` 开头的评论只记录，不唤醒任何 agent。（[Triggering](https://multica.ai/docs/triggering-agents)、[Mentions](https://multica.ai/docs/mentioning-agents)）
- **Autopilot**：由 Runbook、负责人和触发器组成，触发器支持 cron（带下次时间预览）、Webhook 和手动 Run now。有两种模式：**建 issue**（讨论、状态和 run 都落在 issue 上，适合需要人跟进的）和**只跑**（只进运行历史，失败不重试，避免和下一次重叠）。近 7 天至少 50 次运行且失败率达到 90% 时自动暂停，并通知创建者。（[Autopilots](https://multica.ai/docs/autopilots)）
- **技能**：可以手动新建、从本地或 URL（GitHub、ClawHub、Skills.sh）导入、从 runtime 复制，一个技能能绑定多个 agent；外部导入**不做审查、签名或沙箱**。宣传语说「把解决过的问题变成 playbook」，实际靠人工整理，**没有 agent 自动提议技能**。（[Skills](https://multica.ai/docs/skills)）
- **只显式触发**：文档写明 agent 从不自己开工，每次 run 都来自分配、@、私聊或 Autopilot。

**应避免**：agent 互相 @ 没有系统级轮次上限，停止条件只能写进指令；状态全靠 agent 自觉写，忘写就让看板失真；外部技能原样交给 agent；runtime、CLI、自建服务、角色权限、IM 渠道叠在一起，配置面大，面向团队而不是个人。

**对照我们（群聊任务板、委派、同成员排队准入、定时任务、项目经理）**

| Multica 做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| **run 完成 ≠ 任务完成；交付先进「待审核」，done 由人确认** | **借鉴** | 委派 completed（有 check 时须通过）后任务直接变 `done`（`groupTasks.ts` 的 `taskAfterDelegation`），看板只有 todo / doing / done / canceled 四态（`src/shared/types/bot.ts:782`）。人布置的任务缺一道人工验收，也正对应此前「不能把正在测试算完成」的要求。→ Top 3 |
| **阻塞是正式状态：写明缺什么后结束 run，人回复后同一 agent 新开 run 继续** | **借鉴** | 委派中的成员缺信息只能 `ask_user` 同步干等，期间一直占着全局并发名额；委派时限从创建时起算（`delegationService.ts:261`），等人回答也在计时，答晚了就超时。`failure` 只有 interrupted / timeout / denied / error / check，没有「缺信息」这一类。→ Top 3 |
| 失败原因码，每个码配处理建议 | **借鉴**（并入 Top 1） | 现在只有 `failure` 粗分类加原始 `error` 文本。Multica 的码表正好给 Top 1 的「失败原因 → 去配置 / 换模型」映射当分类骨架 |
| 只对瞬时故障自动重试，最多 2 次 | 不做 | 已定不新增重试；换模型回退由 `virtualModels.ts` 负责 |
| issue 与 run 分开，一个任务多次执行都留记录 | 已有（部分） | 看板任务只挂当前那一条 `delegationId`（`bot.ts:796`），重试靠 `retryOf` 串起来，任务卡上看不到历次委派。**借鉴小项**：任务卡按 `taskId` 列出历次委派，只读派生，不新增存储，S |
| agent 过程中发评论、自己改状态；页头「正在工作」标签 | 已有（部分） | 成员可以 `group_task update` 改说明；在场角标（任务编号、已用时、在等谁）只从现有事件推导，mockup 待合入。**刻意不要求成员定期写进度**：每次都要一次工具调用、花 token，而且靠模型守约，忘写看板就失真 |
| 运行中插话进当前 run（steer） | 已有 | 群聊 steer（`groupChat.steer.test.ts`） |
| 每个 agent 并发上限 + 目录锁等待态 | 已有（更细） | 同成员任务准入由分类器判断能否并行，判断失败默认串行（`memberTaskClassifier.ts`）；另有文件级占用（`workspaceClaims.ts`）；桌面和 PWA 已显示排队状态 |
| 排队不过期：「忙」不等于「失联」，按实际活动判断卡死 | **借鉴**（缺陷候选，待核实） | 因同成员串行而排队的委派，也从创建时就开始计时，排久了可能还没开工就超时。建议林经理派 Jason 先写测试确认；这属于 #7 准入的补漏，不参与前 5 排序 |
| 同 agent 的连续评论合并进排队中或追加的 run | 已有（等价） | 每条人类消息每人最多回 2 次 + steer；同成员委派走准入排队 |
| **组长只派不做、派完即停，由系统托管不可编辑的协议；名册带精确 @ 语法** | **借鉴**（并入 Top 4） | 群主（`bossBotId`）只是没人被 @ 时的兜底接收人（`src/shared/bots/router.ts:137`）；「不写代码、拆任务、对照验收」都写在项目经理人设里（`teamTemplates.ts:55`），可能被改掉，也可能被模型忽略。应把这些收成一段只注入群主的固定协议 |
| 成员回帖重新唤醒组长；自己的评论和显式 @ 交接不唤醒；去重 | 已有 | 委派结果自动回传发起人，同轮按批合并（`delegationBatch.ts`）；跳数上限防止循环 |
| 组长每轮写一条「评估记录」 | 不做 | 增加时间线噪音；委派接手、退回已有 system 条目 |
| 子任务按阶段完成后唤醒父任务负责人 | 已有（等价） | 同一轮的多条委派结果合并回传（`batchId`） |
| 发送前的触发预览；`/note` 只记录不唤醒 | 借鉴（小项） | 我们是发出后才由路由决定谁回。预览只能显示确定的部分（被 @ 的人、群主兜底），智能选人那部分显示为「由智能选人决定」；`/note` 适合贴背景资料又不惊动成员。S，可以跟在场角标一起做 |
| 分配确认框里的「暂不开始」、backlog 停放 | 不做 | 看板任务本来就是先建 todo，成员认领或委派后才开工 |
| Autopilot 分「建 issue」和「只跑」两种模式 | 借鉴（小项） | 例行任务的结果只发进聊天。可以加一个「结果需要跟进时建看板任务」开关，复用 `group_task add`，S |
| 失败率高时自动暂停 | 借鉴（小项） | 例程只在依赖缺失时进入 `blocked`（`BOT_ROUTINE_BLOCKS`），连续失败还会一直跑。可以「连续失败 N 次就暂停并进收件箱」，S |
| cron 下次运行预览、手动 Run now | 已有 | 例程编辑器有下次运行时间预览（`src/shared/bots/cron.ts`），也能试运行 |
| Webhook 触发 Autopilot | 不做 | 理由同前：入站入口违反本地优先 |
| 技能导入、多个 agent 复用同一技能 | 已有 | 复用 pi 技能，成员级白名单 |
| 「沉淀成 playbook」 | 现状印证 | Multica 也只做到人工整理和导入，没做 agent 提议。说明自动提议还不是被验证过的刚需，原 Top 5 顺延（补 Cumora 后为第 7） |
| 本地 daemon + 多 CLI runtime、自建服务、角色和 Access、IM 渠道 | 不做 | 我们是单机桌面 + 手机配对，成员直接跑在 pi 运行时上；多人权限和外部渠道已明确不做 |
| 只显式触发，agent 不会自己开工 | 已有（一致） | 和「不做心跳、不做无人触发」的决定一致 |

### ⑥ Cumora（补充对照）

- **定位**：「agent 团队聚集的地方」。人和 agent 在同一个成员列表、私聊、群聊、看板、日历里共事；agent 有人设和记忆，会主动认领任务，还有自己的真实邮箱。三端共用一套 React 组件（Electron、PWA、Capacitor 的 iOS；Android 可自建）。（[README](https://github.com/yetone/cumora)）
- **两种「大脑」**：Cumora Cloud 给每个 agent 一个 K8s pod，用 OpenAI Responses API 跑多跳工具循环；**BYOA** 是用户在自己的 Mac / VPS 上运行 `npx cumora agent computer`，配对后用本地的 Claude Code、Codex 等 10 种引擎干活，服务端拿不到 provider 密钥。两种都通过同一套 `cumora` CLI 协议作用于外界，**所有模型调用（含分诊）都进同一张 `llm_calls` 成本账本**。服务端是无状态 Node + Postgres（权威）+ Redis（广播和在线状态）。
- **和 Multica、我们的区别**：Multica 只显式触发；Cumora 的 agent 会因为看板卡片、日历时段、对话停滞被主动唤醒。群聊协作采用 **fan-out**：每条消息唤醒房间里所有 agent，由各自判断要不要说话。

**机制拆解（`docs/COORDINATION.md`）**

- **为什么需要这么多防线**：fan-out 下 4–7 个 agent 同时被唤醒，会撞上本地 CLI 并发、限流、重复发言、抢同一件活。文档列出的防线依次是：每 agent 固定模型；每台电脑大模型并发上限 6、分诊并发上限 8；启动间隔；自适应限速；唤醒防抖 2.5 秒并合并、同轮 steer；每 agent 限流冷却 60 秒（限流错误永不发到聊天里）；新鲜度门；逐字重复 HOLD；共享资源同名去重；小模型分诊门；常驻提示里的 5 条 `GLANCE_YIELD_RULES`。
- **seen-cursor 新鲜度门**：服务端按「agent × 对话」记录该 agent 已被展示到的 seq（展示即视为已读）。`cumora reply` 发出前比对，如果期间有新消息，就**扣住（HELD）这条回复**，把新消息返回给 agent，让它读完重新决定是否改写再发。绕过开关 `--send-anyway` 必须带服务端在 HOLD 时发的 hold token（绑定 seq，本轮结束、确认或 2 分钟后失效）——早期它是无条件开关，agent 为了省一轮往返会第一次就带上，门形同虚设。另有事务内的**逐字重复 HOLD**，不可绕过；文档、日历同名 15 分钟内去重。
- **原子认领**：`cumora card claim` 用一条 `UPDATE … WHERE 负责人为空 或 是自己 或 卡片 20 分钟没更新` 认领，影响行数是唯一真相，两个 agent 抢同一张卡只有一个能赢，赢的卡自动进「进行中」。原则写进常驻提示：**只认领真实交付物，不认领发言轮次或游戏顺位**。（`server/src/agents/cli.ts` 的 `claim` 分支）
- **小模型分诊门**：每次唤醒先由小模型判 `actionable: boolean`，为真才唤醒大模型。它是纯闸门：**不选人、不决定怎么说**，由大模型进场后自己看局面。原则只有一条：有人类参与或在等就一定放行，只压掉「背后没有真实工作的 agent 互聊」，拿不准就放行。判断依据取自数据库事实（活跃认领、人类是否在看），不看措辞。下面有确定性地板：已认领的对话自上次人类关注起 agent 消息最多 20 条；未认领的对话一旦「绕圈」（消息数超过参与 agent 数）就算死循环；这两条地板「为了 AI 原生的优雅」被删过两次，两次都回归。
- **停滞兜底**：对话静默 5 分钟到 6 小时，心跳任务会让分诊判断要不要催，只有抢到 Redis 锁的那一个 agent 被唤醒；分诊上游挂了时有窄口径的确定性兜底，同一停滞最多兜底 3 次。
- **成本账本与 CI 守卫**：`llm_calls` 记每次调用的用途、来源（cloud / BYOA）、token、成本和状态，按小时汇总；CI 里 `guard-big-brain` 保证只有真实 agent 回合能用大模型，`guard-llm-tracked` 保证所有调用都入账。
- **人设与记忆**：每个 agent 有自己的 home（`CLAUDE.md`、`memory/MEMORY.md`）；工作事实按项目分、身份信息全局；BYOA 的本地记忆不同步到服务端。
- **协作基准**：`benchmarks/` 用真实模型跑接龙、数数、狼人杀、看板四类多 agent 场景，改协作提示后和上一个好的基线对比。
- **反模式（文档专节）**：别为一次事故往提示里堆场景例子；把 5KB 的说话规则和命令目录塞进常驻提示后，每局撞车从 0 次升到 1–3 次；别用改提示词修基础设施故障（分诊上游 503 了几个小时，症状像「agent 不醒」）；绕过开关必须是对服务端已显示状态的确认；软机制下面要有硬上限；只给大模型加并发上限、不给分诊加，压力会挤到另一层；**记忆文件也是状态**（agent 把一次事故写成过拟合的「永远不要……」记忆，此后一直照做）。

**BYOA 的沙箱和凭据边界（`docs/BYOA.md`）**

- daemon 跑在用户机器上，模型拿不到服务端 JWT 和地址，只能经固定的 MCP 桥（文件 IPC，位于可写 home 之外）调 `cumora` 命令；PATH 做了清理。
- Claude Code（≥2.1.248 `--restricted`）和 Codex（自定义权限档）默认 **fail-closed**：文件系统隔离、命令网络白名单为空、子进程环境变量里的凭据被剥离（provider 只拿到 7 个白名单变量）。其他 8 种引擎做不到同等边界，默认从可运行列表里移除，必须显式设 `CUMORA_BYOA_ALLOW_UNSANDBOXED=1` 才能用。
- 配对用一次性 workspace code 换每设备 token（服务端只存哈希，可吊销）；30 秒心跳，离线 90 秒后该电脑上的 agent 显示「睡着」。文档自认弱点：同主机名的机器可以重新挂上旧身份。`--doctor` 同时探测大模型、小模型和唤醒链路。

**证据驱动交付（`docs/SHIPPING.md`）**：`Draft → Contract → Building → Verifying → Ready → Releasing → Watching → Learned`，每道门由服务端把关，UI 和 agent CLI 都绕不过。进 Verifying 要求每条不变量都有证据格和负责人；**执行者不能给自己的证据格打勾**；Ready 要用户路径、trace 和发布说明三类证据；上生产要灰度、回滚方案、可度量基线和审批；上线后 24 小时回读。验证失败自动生成一条摩擦记录和一条可回放的回归用例；回读失败退回 Building。

**应避免**：fan-out 是这一长串防线的根源，每层都是补丁，成本随成员数线性增长；自建要 Postgres、Redis、K8s、Cloudflare Workers、Resend、APNs，配置面大；agent 被看板、日历、停滞主动唤醒，花钱的时机不由人决定；10 种 BYOA 引擎里 8 种默认不可用，兼容面看着大、实际能安全用的只有两种。

**对照我们（群聊选人、@接力、同成员排队准入、委派、看板、配对与审批、交付流程）**

| Cumora 做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| 每条消息唤醒房间里全部 agent（fan-out），各自判断要不要说 | 不做 | 我们是单一回复人 + 顺序 @接力 + 智能选人，一条消息只唤醒 1–3 人，下一跳投递时带上前序内容。fan-out 的成本随成员数线性增长，它的一长串防撞层就是为此付的代价 |
| **seen-cursor 新鲜度门**：回复所依据的消息已过时就扣住，把新消息给它重判；绕过要凭 hold token | 已有（结构上规避）+ **借鉴**（小项，先取证） | 每个成员有投递游标（`chat.sessions[botId].cursor`，等价于「展示即已读」）；选人期间来了新消息会取消并合并重判（`groupChat.ts` 的 routing 分支）。缺口只在并行时：成员回复中人又发了不带 @ 的消息（`route-parallel`）或 @ 了别人（`parallel`，`src/shared/bots/router.ts` 的 `onHumanMessage`），两人同时在答、互相看不到，当前回复人也看不到新消息（只有 @ 他本人才 steer）。照搬「扣住重写」不合适：我们的回复是回合结束时的最终文本，扣住就等于再跑一整轮。可借的做法是**并行期间有人发言时，用现有 steer 给正在跑的成员追加一条新消息提示**。先从真实群聊找撞车样本再定，S |
| 逐字重复 HOLD；文档、日历同名 15 分钟去重 | 不做（暂） | 并行时才可能出现，没见过样本；如果上一条做了，它也会覆盖大部分重复 |
| **原子认领真实工作单元**，20 分钟没动静的认领可被别人接走；不认领发言轮次 | 已有 + **借鉴**（小项） | `groupTasks.ts` 的 `claim` 在 Main 单线程里同步「读-判-写」，第二个认领必然失败；委派走同成员准入（`memberTaskClassifier.ts`），文件走 `workspaceClaims.ts`；我们也只认领看板任务，不认领发言轮次。缺口是认领**不会失效**：成员自己认领后回合结束、再没动静，任务会一直停在 doing，只有成员离群、被删或委派同步时才释放（`releaseMember`）。借鉴方式：看板给「成员自认领、没有运行中的回合、N 分钟没更新」的 doing 任务标「认领可能失效」，人可一键收回为 todo。只在显示时推导，不加后台看门狗，也不自动转给别人。S |
| **小模型分诊门挡在大模型前**：只判要不要动、不选人；有人类参与必放行；拿不准就放行；下面有确定性地板 | 已有（口径不同） | 智能选人同样是小模型挡在大模型前，但它负责选人，出错交群主而不是唤醒全员（`groupChat.ts` 选人失败分支）；地板是跳数上限、每人每条人类消息最多回 2 次、全局 4 人。口径差异源于 fan-out 和单一回复人两种模型，不改。它「只看事实、不看措辞」的原则和我们「状态只由现有事件推导」一致 |
| 分诊上游挂了不静默：窄口径的确定性兜底；「别用提示词修基础设施」 | 已有 | 选人超时或出错交群主；Top 1 让失败原因直达配置 |
| `--doctor` 同时探测大模型、小模型和唤醒链路 | **借鉴**（并入 Top 1） | 首跑实测时把智能选人 / 助理模型也测一次：它坏了不会报错，只会让所有消息悄悄交给群主 |
| **`llm_calls` 成本账本**：每次调用（含分诊）都记用途、来源、token、成本；CI 守卫保证都入账、只有真实回合用大模型 | **借鉴** → 新 Top 5 | Bot 用量和日预算只读成员会话 jsonl（`botUsage.ts`）；智能选人、核心笔记重写、记忆整理、AI 生成人设都走 `completeText`（`src/main/services/agentHost.ts:1184`），不留用量记录。群里每条没有 @ 的人类消息都多一次选人调用，空闲整理也在花钱，用量页和预算都看不到 |
| 每 agent 人设与记忆；工作事实按项目分、身份全局 | 已有 | 人设 + `bot:` / `chat:` / 项目记忆空间 + 核心笔记。它的教训「记忆文件也是状态」正好支持 Top 2 的来源追溯和笔记版本回退：成员记下一条过拟合规则后，要能查出来自哪里、能撤回 |
| 看板，agent 主动认领 | 已有（部分） | 群看板支持认领、委派、`check` 验收；成员只在被唤醒的回合里认领，不会因为看板有空卡被主动唤醒（见下一行） |
| 日历；看板卡片、日历时段、对话停滞触发的主动唤醒 | 不做 | 本质都是无人触发的轮次，违反已定原则。定时需求由例行任务和「稍后提醒」覆盖；停滞要让人看见，靠在场角标的「卡住」和收件箱 |
| agent 真实邮箱收发（Resend + Cloudflare Email Worker） | 不做 | 属于外部渠道和入站入口，违反本地优先 |
| 云端每 agent 一个 K8s pod、服务端 Postgres / Redis、FUSE 挂载工作区 | 不做 | 我们以单机桌面为宿主，手机只是配对客户端；由服务端托管执行和数据，与本地优先冲突，也是远程沙箱的一种 |
| **BYOA**：本机 daemon 跑本地 Claude Code / Codex，服务端拿不到密钥；设备 token 哈希存储可吊销；离线显示「睡着」 | 已有（等价） | 我们本来就是这种形态：成员跑在本机 pi 运行时，API key 只在 Main（AGENTS.md 约定），手机扫码配对、设备可解绑，权限分只读 / 可操作两档 |
| **BYOA 默认 fail-closed 沙箱**：文件隔离、命令无网络、子进程剥离凭据；做不到的引擎须显式 opt-in | 不做（OS 级沙箱）+ **待核实**（凭据剥离） | 我们的执行边界是审批档 + 五类受保护动作（含读密钥）+ 文件级占用。不做 OS 级沙箱：远程 / 容器沙箱已定不做，本机系统沙箱要逐平台适配，Windows 没有对应机制。可借的一点需要先核实：**成员执行的 shell 命令是否继承了带 provider 密钥的环境变量**。如果继承，按 Cumora 的做法用白名单过滤子进程环境变量。这属于安全缺陷修复，不参与排序，建议林经理派 Jason 先写测试确认 |
| **SHIPPING 证据驱动交付**：执行者不能给自己的证据格打勾；Ready 要用户路径证据；上生产要回滚方案；上线 24 小时回读；失败自动变回归用例 | 已有（约定层）+ **借鉴一点**（并入 Top 3） | 我们「先验证再标完成」靠约定执行：AGENTS.md 要求测试先行和双厂商真机验证；林经理要求「正在测试不算完成，须独立审查」；每次部署都留回滚包。看板 `check` 要求工具输出里出现指定文本才能完成，算是证据门，但证据来自执行者自己的工具输出（`groupTasks.ts` 的 `checkPassed`）。借鉴「执行者不能自证」，写进 Top 3：待验收由人或另一位成员确认。整套八阶段流程和服务端门禁不做：那是面向多人团队的发布流程，对个人本地工具太重；24 小时回读需要线上指标和无人触发的检查 |
| 真实模型协作基准（接龙、数数、狼人杀、看板），改提示后对比上一个好基线 | **借鉴**（小项） | 我们改选人、接力提示词靠手测加双厂商真机。可以把 3–4 段固定群聊脚本做成可重复跑的回归，统计撞车、空转、越界次数；Top 4 改人设和群主协议时正好拿来验证。S–M，不进前 5 |
| 反模式：别为一次事故往提示里堆场景例子；绕过开关必须确认服务端已显示的状态；软机制下面要有硬上限 | **借鉴**（原则，并入 Top 4） | 群主协议保持「形状级」短规则（Cumora 固定 5 条），不按事故加例子。硬上限我们已有（跳数、每人 2 次、全局 4 人） |

### ⑦ Octop（补充对照）

- **定位**：面向家庭和小团队的自托管 AI 助手。单进程（FastAPI + APScheduler）同时跑 Web 控制台、CLI、IM 通道和定时任务，控制面默认是 `~/.octop/octop.db`（SQLite，可换 PostgreSQL）。一个管理员账号，全家或小团队共用，每个用户有多个「专家」（agent），各自有工作区、模型、通道和定时任务。运行时、IM 网关、记忆、浏览器自动化分别拆成 octop-harness / gateway / memory / browser 四个库。（[README](https://github.com/TencentCloud/Octop/blob/main/README_CN.md)、`docs/architecture.md`）
- **和我们的区别**：多用户、IM 优先、服务端形态；我们是单人桌面 + 手机配对。协作形态（主持人 + 成员、群聊上墙、异步派工后回叫）和我们的群主 + 委派很接近。

**重点 1：tool_guard 命令护栏（`~/.octop/security/tool_guard/`）**

- **规则长什么样**：一个 YAML 文件，首次启动时从 octop-harness 内置的 `dangerous_shell_commands.yaml` 复制过来，共 20 条。每条规则写适用工具（`bash` / `execute`）、扫描的参数（`command`）、严重级别（MEDIUM / HIGH / CRITICAL）、若干条正则 `patterns`，以及可选的排除正则 `exclude_patterns`。例如 `TOOL_CMD_DANGEROUS_RM` 的正则是 `\brm\b`、`\bdel\b`、`\bRemove-Item\b`，级别 HIGH；`mv` 也是 HIGH。README 说是「允许 / 拒绝规则」，实际**只有黑名单**，没有允许规则，`exclude_patterns` 只是单条规则内的例外。（octop-harness `security/tool_guard/rules/dangerous_shell_commands.yaml`）
- **命中后怎么处理**：规则本身不带动作，由一个**全局模式**决定：`block` 拦 HIGH / CRITICAL，`require_approval` 对 MEDIUM 及以上暂停等人批（只有「批准 / 拒绝」，没有「总是允许」），`warn` 只写日志。**Octop 的默认值是 `warn`，工具审批（HITL）默认也是关的**（`infra/agents/security/policy_store.py` 的 `_default_policy`），开箱即用时等于没有护栏。（octop-harness `security/tool_guard/engine.py`、`middleware/tool_guard.py`）
- **用户怎么改**：管理员在「设置 → 安全」里直接编辑 YAML，保存前校验格式，校验不过就拒绝；保存后运行中的 agent 自动重载；可以一键恢复内置规则；每次修改写审计日志（`security.tool_guard_rules.update / reset`）。也可以直接改文件后重启。只有管理员能改，规则对所有用户、所有 agent 生效。（`api/routers/security.py`、`infra/agents/security/tool_guard_rules.py`、前端 `Settings/Security/ToolGuardRulesPanel.tsx`）
- **问题**：对整条命令字符串做正则，不拆管道、不剥 `sudo` / `sh -c` 之类的包装，`\brm\b` 连 `grep rm` 也会命中；动作只能全局一档，不能「这条禁止、那条只问一下」；默认 `warn` 让规则形同虚设。

**对照我们（审批与受保护动作）**

| 维度 | Octop tool_guard | 我们 |
|---|---|---|
| 默认是否生效 | 默认 `warn` 只记日志，HITL 默认关 | Bot 成员只要不是完全放行，受保护底线就一直开着；Code 模式可在设置里开（默认关） |
| 危险命令识别 | 20 条正则，整串匹配 | `src/agent/protectedActions.ts` 的规则分类器：按管道 / `&&` / `$()` 拆段，剥掉 `sudo`、`env`、`xargs`、`sh -c` 等包装，识别删除、部署、外发、付款、读密钥五类，覆盖 git / kubectl / terraform / curl / 数据库客户端 / MCP 工具名等。比正则准 |
| 命中后的动作 | 全局一档：拦截 / 要审批 / 只记录 | 受保护动作一律等真人确认，不交给代审模型，也不受「本会话总是允许」影响（`src/agent/approval.ts` 的 `withApproval`、`respond`） |
| 日常命令放行 | 没有允许规则 | 四档审批（逐项确认 / 自动改文件 / 模型代审 / 完全放行）+「本会话总是允许」。**这个「总是允许」按工具名记**（`approval.ts:157` 把 `bash` 整个加进会话白名单），批了一次 `npm test`，本会话之后的所有 shell 命令都不再问；Code 模式默认不开底线，这之后连 `rm -rf` 也不再问 |
| 用户能否编辑规则 | 管理员可编辑 YAML，校验、热重载、恢复默认、审计 | **不能**。受保护分类器写死在代码里，设置里只有一个总开关（`BuiltinToolsSettings.tsx` 的「受保护动作确认」）；没有持久的允许或禁止规则 |

**要不要做「用户可编辑命令规则」**：值得做，但不照搬 Octop 的正则黑名单，分两步。

1. **先收窄「本会话总是允许」**（S，1–1.5 人日，顺手做，不进排序）：命令类审批的「总是允许」只放行同一前缀（程序名 + 子命令，如 `npm test`、`git status`），复用 `programTokens` 拆段，命令里每一段都匹配才放行；文件编辑和 MCP 仍按工具名。改 `ApprovalGate` 的会话白名单、桌面 / Bot 收件箱 / PWA 审批卡的按钮文案（「本会话总是允许 `npm test`」）。这一步修的是现有粒度过粗的问题，不新增配置。
2. **再做持久规则**（M，约 4–5 人日，排第 8）：设置里一张规则表，每条是「命令前缀或通配 + 动作（免审 / 必须确认 / 禁止）」，可从审批卡一键生成「以后都允许」。优先级：禁止 > 受保护底线 > 必须确认 > 免审 > 会话白名单 > 档位；**免审永远不能盖过受保护底线**（对应 dots「敏感任务永远由人做」）；禁止在完全放行档也生效。成本拆分：shared 规则类型与匹配（按 `unknown` 收窄，覆盖管道、`sh -c`、包装程序等绕过写法）约 1 人日；设置持久化、configSync 口径（建议设备本地）、Main 在启动会话时下发给 worker（参照 `agentHost.ts:939` 下发底线开关的方式）约 1 人日；`ApprovalGate` 优先级与测试 0.5–1 人日；设置页规则表和审批卡入口 1–1.5 人日。是否按成员单独配置待定，先做全局。
   - **为什么不进前 5**：Octop 自己默认都不开，说明「用户手写规则」不是高频需求；我们的底线已经覆盖高危动作，持久规则的主要价值在减少日常审批打扰，目前没有数据证明这个打扰有多大。第一步上线后，如果用户仍然频繁选「完全放行」或反复批同一类命令，再做第二步。
   - **不做**：不做 YAML / 正则编辑器（门槛高、容易写出漏洞或误伤）；不让用户删改内置的受保护分类。

**重点 2：memory slim（`octop memory slim`、聊天里 `/memory slim`）**

- **它做什么**：整理 agent 的 `memory.sqlite`：等当前对话结束 → 整库备份到原文件旁（`memory.sqlite.before-slim.<随机ID>.bak`，不自动删除）→ 去重 LangGraph 对话检查点里的重复内容 → VACUUM 回收空间 → 恢复使用。文档写明**历史 ID、metadata、parent、writes 和业务记忆都不删除**，也不做历史裁剪。它是**存储维护**，目的是省磁盘，不是让 agent 忘掉什么。只支持 SQLite，PostgreSQL 会明确提示「未执行」。（`docs/memory-slim.md`、`infra/agents/memory/slim.py`）
- **流程纪律**（值得学的部分）：
  - 聊天里不带 `--confirm` 只说明作用、影响（备份占空间、整理期间暂停发送、无法预估耗时）和目标范围，**不建任务、不备份、不改任何东西**；带 `--confirm` 时重新计算候选范围并重新校验权限。
  - 等待空闲 120 秒找不到窗口就失败退出，不强行打断对话；整理期间该 agent 的所有会话暂停发送，其他 agent 照常用；同一时间只跑一个整理任务，并与历史回填互斥。
  - 进度只报阶段、已用时间和已扫描条数，**不给假的百分比和剩余时间**；空间没回收完就如实说「去重完成但空间回收未完成」，不自动回滚。结果用 `/memory status` 查，完成提示里给备份文件名。
  - 只能在网页或本地 CLI 触发；IM 里的发送者身份没法验证，所以 IM 不开放。不由模型调用，是注册的斜杠命令。

**能否和 Top 2「记忆可追溯、预览后再遗忘」合并：不能合并成一项，只借纪律。**

- 解决的问题不同：Top 2 要删的是「从某段对话学来的、错误或过时的记忆」，是语义层面的撤回；memory slim 不删任何记忆，只回收检查点的重复存储。
- 我们没有它要解决的问题：会话权威源是 pi 的 jsonl，压缩由 pi 负责，记忆库里没有对话检查点。目前也没有记忆库体积膨胀的反馈或数据。所以 **memory slim 功能本身不做**。
- 并入 Top 2 的三条验收口径：
  1. **遗忘默认走归档，可撤销**：现有 `archiveMemory` / `restoreMemory`（`src/main/services/memoryAdmin.ts:178`）就是软删除，「忘掉这段对话学到的」默认把条目归档，结果里给「撤销这次遗忘」；彻底删除另做一步，并单独确认。这就是我们的「先备份」，比整库文件备份便宜，工作量不变。
  2. **预览无副作用，确认时重算**：预览只读；确认时按当前数据重新算一遍范围，预览之后新整理出来的同源条目也一并处理，和预览不一致时先提示。
  3. **与整理互斥、结果可查**：执行时等进行中的记忆整理收尾（Top 2 风险里已列），结束后告诉用户归档了几条、怎么撤销，不显示假进度。

**其余能力**

| Octop 做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| **AgentTeams**（Beta）：主持人只调度，专业工作一律异步派给成员；成员气泡直接上群时间线；成员做完回叫主持人，由主持人总结并判断是否收工；一轮可并行派多人；同一成员串行、不同成员并行 | 已有 | 群主兜底 + `delegate` 委派 + 同轮结果合并回传（`delegationBatch.ts`）+ 同成员任务准入（`memberTaskClassifier.ts`）。成员收到的是主持人改写后的任务书、群聊记录只作背景，和我们的委派 task / context 一致 |
| 主持人的「只派不做」靠**收掉工具**保证：主持人只挂 `agent_list`、`ask_agent`、记忆和时间，没有文件系统、浏览器、MCP、技能 | **借鉴**（一点，并入 Top 4） | 我们的群主只靠人设和（拟议的）固定协议约束，模型可能忽略。Top 4 可加一个可选项：纯协调型群主的模板只配委派、看板和记忆，不配写文件和 shell，用权限而不是提示词兜底。现有成员档案能否关掉内置工具需要先查，查不到再定是否扩展 |
| 用户新消息一律先到主持人；`@` 只作「优先」提示，主持人可以派给别人 | 不做 | 我们 `@` 直达被点名的人，没 @ 才由智能选人或群主接。全部经主持人会多一跳延迟和 token，也违背用户点名的意图 |
| 在途派工只在内存里，重启就丢 | 我们更好 | 委派有持久记录，重启后在途委派标为 `interrupted`，可以重试（`delegationService.ts:117`） |
| **MBTI 人格**：16 种模板加互动测试，渲染成 `SOUL.md` 骨架，用户自定义提示词追加在后面；人格内容故意不开放编辑，避免行为不可复现 | 不做 | 我们有岗位模板和「AI 生成人设」。MBTI 改的是语气，不是职责和边界，解决不了越界、抢活；Top 4 走岗位契约方向。「模板做骨架、用户补充追加在后」的结构我们已经等价 |
| **自然语言定时任务**：模型调 `cronjob_create` 建任务，默认**立即启用**；支持 cron / 间隔 / `date:` 一次性；`task_type=text` 时到点**原样推送一句话、不调模型** | 已有（更稳）+ **借鉴**（小项） | 我们的 `routine_propose` 也能从对话自然语言建例程，但先进草稿、人批准后才生效，比默认启用稳。可借的是「纯提醒」：到点只发一条固定消息，不唤醒成员、零 token，和之前列的一次性 `at` 提醒合成一个小项，S |
| **ACP 入站**：`octop acp` 把 agent 作为 stdio ACP 服务给 Zed 等 IDE 用 | 不做 | Code 模式本身就是 IDE 侧的 agent；再开一个对外入口，收益小 |
| **ACP 出站**：`acp_runner` 把编码任务委派给 OpenCode、Claude Code、Codex、pi 等外部 CLI；外部 agent 的权限请求转进聊天，**可以由模型自己调 `action=respond` 选选项** | 不做 + **应避免** | 成员本来就跑在 pi 运行时上，能选多家模型。外部 CLI 的操作绕过我们的 `ApprovalGate` 和受保护底线；让模型替人回答对方的权限请求，等于让执行方自己批自己，和 Top 3「执行者不能自证」相反 |
| IM 渠道：飞书、钉钉、QQ、微信、企业微信等，Web / IM / 定时任务共用一条处理链路 | 不做 | 外部 IM 已明确不做。它自己也承认 IM 里发送者身份无法验证，所以连记忆维护都不在 IM 开放 |
| 多用户：JWT 认证、管理员角色、按用户隔离 agent 和工作区；专家共享、专家市场、技能 / 子智能体共享池 | 不做 | 单机单人本地；市场类已明确不做 |
| Docker 沙箱：工作区后端可选 `docker`，把文件工具和 `execute` 放进容器（需要本机 Docker daemon）；另有 PostgreSQL、COS / S3 后端 | 不做 | 容器沙箱已明确不做，本地 Docker 对桌面用户门槛太高；我们靠受保护底线 + 审批 + 文件级占用 |
| 远程桌面：控制台里实时看屏、键鼠操控，无图形 Linux 可一键起隔离桌面（Xvnc + XFCE） | 不做 | 远程执行面太大，远程节点已明确不做。本机的浏览器自动化和桌面操作我们已有（`src/agent/tools/browser.ts`、`computer.ts`） |
| 审计日志：安全策略、规则修改都记一条 | 借鉴（随第 8 条） | 如果做持久命令规则，规则的增删改写一条本地记录即可，不单独做审计系统 |

**应避免**：安全开关默认全关（HITL 关、tool_guard 只记日志），README 写「更安全」但开箱没有护栏；正则黑名单整串匹配，误伤多又容易绕过；让模型替人回答外部 agent 的权限请求；多用户、IM、远程桌面、多种存储后端叠在一起，配置面大。知识库 RAG、Connector、插件与本次问题无关，未展开。

### 闭源原型里值得记一笔的设计（不照搬）

- Grok Bot：**示范一次即保存为例行任务**（teach by demo）；Team Bots 共享同一个 Bot 时，每个人的对话和记忆分开、技能共享。（[Introducing Grok Bot](https://x.ai/news/introducing-grok-bot)、[Team Bots](https://x.ai/news/team-bots)）
- dots：空闲时做「主动研究」，但**只用只读工具**；有自动审查，加上用户自定义的允许 / 需审批 / 禁止规则；敏感任务（比如改密码）永远由人来做；有 Activity View 看后台工作。（[Introducing dots](https://openai.com/index/introducing-dots/)）

## 三、对照我们的现状

现状依据：`src/main/services/bots/*`、`packages/phone/src/*`、[`2026-10-03-bot-mode-design.md`](2026-10-03-bot-mode-design.md)、[`2026-10-06-group-threads-design.md`](2026-10-06-group-threads-design.md)，以及群里已经定下的决定。

标注说明：**借鉴** = 值得借鉴；**已有** = 我们已有（含等价实现）；**不做** = 刻意不做。

### 会话与记忆

| 外部做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| 记忆分层：用户偏好 / 长期事实 / 日记 / 整理日志（OpenClaw、nanobot） | 已有 | `bot:` / `chat:` 记忆空间 + 每成员和每群一份 3000 字核心笔记，自动注入（`botNotes.ts`）；资料页可查看、编辑、删除 |
| 后台整理，模型判断只在确定性闸门内（Dreaming、Dream） | 已有 | 空闲 30 分钟、压缩成功、私聊开新对话时按水位增量整理（`botMemory.ts`），再由助理模型重写笔记 |
| 写入路径就是安全边界 | 已有 | 注入扫描 + 脱敏；成员写 global / project 进 `pending_writes` 待批 |
| **记忆来源追溯 + 按会话遗忘（先预览再删）**（OpenClaw） | **借鉴** | `memories` 表只有 `source` 类别字段，没有记录来源会话（`src/main/services/memory/db.ts`）；现在删成员 / 删群只能整空间删。→ Top 2 |
| 记忆文件变更历史，可回滚（nanobot GitStore、Dreaming 改写前存原文） | **借鉴**（并入 Top 2） | 笔记只有内容哈希 version，没有历史；自动重写把笔记改坏了无法回退 |
| 注入块显示容量百分比，写满时报错而不是截断（Hermes） | **借鉴**（小项） | 核心笔记超过 3000 字直接截断，用户和模型都看不到。可以在笔记重写提示里给预算、资料页显示用量，S 级，可顺手做 |
| 冻结快照，利于前缀缓存（Hermes） | 已有 | 笔记变化时用 `<notes-updated>` 追加到下一条消息前，不改系统提示 |
| 每轮先起子代理做深度回忆（Active Memory） | 不做 | 每条消息多一次模型调用，群里接力时成本和延迟会成倍叠加；核心笔记注入已经解决「成员想不起来去查」的问题 |
| 事件条件式前瞻记忆（Standing intents） | 借鉴（后续） | 只由人类消息触发，不违背「不做无人触发」；价值中等，排在 Top 5 之后 |
| 所有私信汇成一个主会话（Main session） | 不做 | 这是为跨 IM 渠道设计的；我们按「成员 × 聊天」各开一个会话 |
| 会话分叉 / 恢复 / 搜索 | 已有 | 群话题（隐藏子群）、私聊切回旧对话续聊、私聊回退 / 重试（`rewind.ts`）、⌘K 全文搜索、`group_history` 工具、压缩后补 `<group-state>` |
| 有人插手时给观察者发一条过期提醒（Session state awareness） | 已有（等价） | 看板变更、委派接手 / 退回都会写 system 时间线条目，进其他成员的增量上下文；委派会话不对人开放直接对话 |

### 多 agent 协作与群聊

| 外部做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| @ 门控 + 有上限的多轮（Broadcast groups）、分派器选 1–3 人（OpenGrokBot） | 已有 | 单一回复人 + @ 接力 + 跳数上限 + 智能选人（`smartRouter.ts`），每人每条人类消息最多回 2 次，支持 `[skip]` |
| 没被 @ 的消息当静默上下文，显式调工具才发言（Ambient room events） | 已有（等价） | 智能选人 + `[skip]`；不做「始终监听」，因为每条消息都要唤醒模型 |
| **Lane 契约：职责 / 非目标 / 聊天预算 / 交接 / 工具风险**（Specialist lanes）；反套话人设指南（SOUL.md） | **借鉴** | 团队模板已经让职责互斥、委派单向，但人设是自由文本，没有「不做什么、长任务怎么处理」的固定结构。→ Top 4 |
| 子代理 spawn / yield / 取消（Session tools） | 已有 | `delegate` / `check_delegation`，深度 2、并发 3，`check` 验收条件，群看板认领 |
| 按会话串行 + 全局并发上限 | 已有 | 全局 4 个成员同时运行；同成员任务准入、文件级占用（`workspaceClaims.ts`） |
| 群聊导出 Markdown（OpenGrokBot） | 借鉴（小项，并入 Top 2 的导出） | 现在只能导出团队配置，不能导出聊天内容 |
| 成员在聊天里自己拉新成员（NanoClaw） | 不做 | 绕过人工审阅人设和权限；保留人类经模板 / 目标引导创建 |
| 跨渠道 agent 互发消息（`conversations_send`、Reef、A2A） | 不做 | 外部渠道已明确不做 |

### 定时与主动触发

| 外部做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| cron 加自然语言调度 | 已有 | `routineScheduler`，支持简单描述和 cron、草稿审批、试运行、只补跑最近一次、阻塞检测、运行历史 |
| **运行前跑脚本闸门，没活不唤醒模型**（NanoClaw；OpenClaw 条件触发） | **借鉴** | 现在每次到点都要唤醒成员，跑一整轮。→ 第 6 条 |
| 一次性 `at` 提醒（「20 分钟后提醒我」） | 借鉴（小项） | 例程只支持周期调度；聊天的「稍后提醒」只能提醒整个聊天，不能触发成员干活 |
| 整点任务自动错开 | 不做 | 单机本地，没有负载尖峰问题 |
| 心跳：周期唤醒主会话（Heartbeat）；空闲时主动研究（dots） | 不做 | 本质是无人触发的自主轮次，没有停止条件、会空转烧钱，已明确不做；需要时用例行任务 |
| 常设授权写进上下文（Standing orders） | 已有 | 人设 + 核心笔记 + 例行任务 |
| 入站 Webhook / Gmail PubSub 触发（OpenClaw、OpenGrokBot） | 不做 | 要对外暴露入口，违反本地优先，也属于外部渠道 |
| 示范一次即存为例程（Grok Bot） | 不做（本期） | 需要录制操作并泛化，可靠性低；现有 `routine_propose` 让成员从对话提议例程，已覆盖大半 |

### 技能与插件

| 外部做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| SKILL.md、按来源决定优先级、成员级白名单 | 已有 | 复用 pi 技能；成员档案可配技能和 MCP；输入框 `$技能` |
| **agent 提议技能草稿 → 人审 → 生效，可回滚**（Skill Workshop；Hermes 自动沉淀） | **借鉴** | 成员没有办法把做成的流程沉淀成技能。→ 第 7 条（原 Top 5，补 Multica、Cumora 后两次顺延；取 OpenClaw 的审批形态，不取 Hermes 的自动改） |
| 技能 / 插件市场（ClawHub、OpenGrokBot MCP 市场） | 不做 | 有供应链风险，还要长期运营审核；Code 侧已有技能和 MCP 配置入口 |
| 插件 SDK | 已有 | pi 扩展、MCP |

### 移动端配对与语音

| 外部做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| 二维码配对，设备令牌可吊销 | 已有 | `PairScreen` 扫码，经中继或局域网直连；设置 → 设备可解绑 |
| 设备分级权限 | 已有 | 只读 / 可操作两档，在 host 端拦截 |
| 离线发件箱，按顺序幂等重发 | 已有 | `botOutbox.ts`，IndexedDB，deliveryId 去重 |
| 离线过久的消息过期不发（iOS 48h） | 借鉴（小项） | 我们的队列没有过期；离线一晚后补发「帮我看下现在的报错」可能已经过时。可加「超过 N 小时转为待确认」，S 级 |
| 离线只读缓存、休眠 / 归档会话 | 已有 | `sessionCache.ts`；桌面有搁置 / 稍后提醒 |
| 听写 | 已有 | 手机和桌面的 `VoiceInputButton`，录音上传云端 ASR |
| 实时语音对话、语音唤醒、Apple Watch（Talk、Voice wake） | 不做 | 语音通话已明确不做，维护成本高 |
| 设备节点能力：相机、屏幕、定位、远程执行（Nodes） | 不做 | 远程执行面太大；远程节点也不出 Bot 视图 |
| 陌生发件人配对码（DM pairing） | 不做 | 没有外部 IM，就不存在陌生发件人 |

### 审批与沙箱安全

| 外部做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| allow-once / allow-always / deny + 规则 | 已有（部分） | 审批档 + 本会话总是允许；收件箱汇总；例行任务轮次 30 分钟无人处理自动拒绝。**用户不能自己写命令规则**，「本会话总是允许」按工具名放行、粒度过粗（补 Octop 后核实，见 ⑦ 节，收窄为顺手项，持久规则排第 8） |
| 敏感动作永远交给人（dots） | 已有 | 删除、部署、外发、付款、读密钥五类受保护动作，规则分类器命中后强制人工确认（`src/agent/protectedActions.ts`） |
| agent 拿不到原始凭据（NanoClaw 凭据网关） | 已有（部分） | API key 和 MCP env 明文只保留在 Main；成员在工作区里自己读 `.env` 也会触发受保护确认 |
| 容器 / 远程沙箱（OpenClaw 多后端、NanoClaw 每 agent 一个容器、Hermes 七种后端） | 不做 | 远程沙箱已明确不做；本地 Docker 对桌面用户门槛太高；现在靠受保护动作底线 + 审批 + 文件级占用 |
| 安全体检命令（`openclaw security audit` / `doctor`） | 借鉴（并入 Top 1） | 首跑和失败时给出可执行的修复入口即可，不做独立的体检工具 |

### Onboarding

| 外部做法 | 标注 | 我们的现状 / 理由 |
|---|---|---|
| **先实测推理，只保存能用的路线，失败当场修**（OpenClaw onboard / setup） | **借鉴** | 目标式引导在模型不可用时只返回 `no-model` / `timeout`，用户要自己去找设置。→ Top 1（复用 `ProviderApiForm` 已有的连通性测试，不新建向导） |
| 内置岗位模板、AI 生成人设 | 已有 | 3 个团队模板 + 5 个成员模板，「AI 生成人设」「自动设置能力」 |
| 「三步验证」首跑（nanobot） | 已有（等价） | 目标式引导创建后，第一条消息预填在输入框里 |
| 从其他助理导入记忆（OpenClaw 从 Codex、Claude Code、Hermes；Hermes 从 OpenClaw） | 借鉴（后续） | Code 侧已有会话导入；导入记忆到成员空间价值中等，排在 Top 5 之后 |

## 四、前 5 条借鉴建议（按价值 / 成本排序）

> 工作量按一人日粗估，不含真机双厂商验证。所有改动遵循 AGENTS.md：先写测试，新增 IPC 三处同步，入参按 `unknown` 收窄。

### 1. 首跑先验证模型，失败按原因直达配置

- **借鉴自**：OpenClaw `onboard` / `setup` 的推理闸门、`doctor`；Multica 的失败原因码表；Cumora `--doctor` 同时探测大、小模型。
- **做什么**：Bot 模式首次进入、或打开「从目标开始」时，先用 Bot 助理模型链做一次最小实测；失败就显示具体原因（未配置模型 / 鉴权失败 / 超时 / 额度不足），并给出「去配置」（打开现有的 `ProviderApiForm` 连通性测试）和「换模型」两个按钮。成员回合失败时，群里和私聊的提示也给同样的入口。**不新建向导，不新增重试或回退机制**（回退已由 `virtualModels.ts` 负责）。
- **也测智能选人模型**（补 Cumora）：它出错时群聊会静默交给群主，用户只会觉得「怎么总是群主回」。首跑实测同时测成员默认模型和选人 / 助理模型，分别报告。
- **原因分类**（补 Multica）：参照它的码表，把原始错误归到几个能直接行动的类：鉴权失败、额度用尽、限流或容量不足、模型不存在、上下文超长、网络、缺少配置、成员主动中止。每类固定对应一个动作（去配置 / 换模型 / 稍后再试 / 缩小任务）。委派失败卡片和看板任务也用同一套分类。
- **落在哪层**：renderer 改 `GoalOnboarding` 和失败条目渲染；Main 复用 `assistantCompleter` / `runSuggest` 的错误码，可能新增一个只读探测 IPC。
- **工作量**：S–M，2–3 人日。和既定优先项「失败恢复闭环」一起做。
- **风险**：低。探测会消耗少量 token，要防重复探测（按会话缓存结果）；错误码到文案的映射要覆盖多家 provider。

### 2. 记忆来源追溯，可预览后按对话遗忘（含笔记历史和群聊导出）

- **借鉴自**：OpenClaw 的 memory provenance 和 `forget --dry-run`；nanobot GitStore；OpenGrokBot 的群聊导出 Markdown；Cumora「记忆文件也是状态」的教训（成员记下一条过拟合规则后会一直照做，必须能追溯和撤回）。
- **做什么**：自动整理写入的记忆记录来源（conversationId、entry 范围、成员 / 群）；资料页每条记忆显示「来自 · 某对话 · 时间」，可以跳回原对话；提供「忘掉这段对话学到的」，先列出将删除的条目，确认后再删，并把这段对话标为已遗忘，防止重新整理时写回来；多来源条目只解除这一个来源，不整条删。核心笔记每次重写保留最近 N 个版本，可以回退。和既定的「记忆导出与恢复预览」共用同一套预览界面，导出时附带群聊 Markdown。
- **落在哪层**：Main memory（db 迁移新增 provenance 表，写在蒸馏写入路径上，按来源删除）、`botNotes.ts`（版本历史）、bots IPC、renderer 资料页记忆标签页。
- **验收口径**（补 Octop memory slim 的流程纪律，不合并它的功能）：遗忘默认走现有归档（`archiveMemory` / `restoreMemory`），结果里可以「撤销这次遗忘」，彻底删除另做一步并单独确认；预览只读，确认时按当前数据重算范围，与预览不一致先提示；执行时与记忆整理互斥，结束后报告归档条数和撤销入口，不显示假进度。
- **工作量**：M，5–7 人日（含迁移和测试）。
- **风险**：有数据库迁移；旧记忆没有来源，只能标「来源未知」；结晶和 evolves 产生的混合来源规则要先定清楚；删除与正在进行的整理之间有竞态（可参照 `memoryCleanup.ts`，先等整理收尾再删）。

### 3. 看板任务交还验收与阻塞上报（补 Multica 后新增）

- **借鉴自**：Multica 的 `in_review` / `blocked` 状态、`agent_blocked` 失败原因、「run 完成 ≠ issue 完成」；Cumora SHIPPING「执行者不能给自己的证据格打勾」。
- **做什么**：看板增加「待验收」「待补充」两态。
  - **交还验收**：人创建的任务，关联委派完成（有 check 时须通过）后进入「待验收」，不再直接变 `done`。人在任务卡上点「通过」变 `done`；点「退回」并写一句原因，任务回到 todo，原因作为上下文走现有重试（`retryOf`）再派。成员自己建的子任务保持现状，由发起的成员核对结果，避免人成为瓶颈。**执行者不能验收自己的任务**（补 Cumora）：`check` 只证明执行者的工具输出里出现了指定文本，仍是自证；待验收只能由人或发起成员确认。
  - **阻塞上报**：委派中的成员缺信息时，用 `group_task` 新增的 `block` 动作写明缺什么。本次委派以新增的失败类 `blocked` 结束，释放并发名额，计时也随之停止；任务进入「待补充」并进收件箱，卡片上显示问题。人在卡片上回答后，以回答为上下文走现有重试接着做。`ask_user` 保留给需要当场拍板的小问题。
  - 在场角标的「等你」把待验收、待补充算进去。「待补充」和角标里的「卡住」（90 秒无输出或委派失败）不是一回事，文案要分开。
- **不做**：不新增自动重试；不允许成员自己把任务改成 done；不引入 Multica 的自定义状态。
- **落在哪层**：shared 的 `GROUP_TASK_STATUSES`、`Delegation.failure` 及其解析；Main 的 `groupTasks.ts`（状态机、`block` 动作）和 `delegationService.ts`（blocked 结算）；renderer 与 PWA 的看板、收件箱。
- **工作量**：M，4–6 人日。
- **风险**：状态枚举扩展会遇到新旧版本混用：`parseGroupTask` 遇到未知状态会丢掉整条任务（`src/shared/types/bot.ts:836`），旧版客户端如果走同一个解析就看不到这些任务，需要先让旧版能降级显示，或者桌面和 PWA 同步发布。成员可能把 `block` 当成推活手段，要求必须写具体问题，并在收件箱里能看到次数。人迟迟不验收会让任务堆积，看板需要「待验收」筛选。

### 4. 团队模板改成岗位契约结构，群主加固定派单协议

- **借鉴自**：OpenClaw parallel specialist lanes 的 lane 契约、SOUL.md 指南；Multica Squad 的组长操作协议；Cumora 的提示词反模式。
- **做什么**：内置团队模板和「AI 生成人设」都输出固定段落：职责 / 不做什么（交给谁）/ 聊天预算（长任务先一句话确认，再委派或建看板任务）/ 交接格式 / 工具风险偏好；生成提示里加上反套话规则（不用客套开场、先给结论）。
- **群主协议**（补 Multica）：只给群主（`bossBotId`）注入一段系统维护、不能在人设里删掉的固定段落：派活时写清验收标准、不复述需求、派完就停、不替成员实现、成员全部回报后对照标准汇总，人布置的任务交给人验收（配合 Top 3）。人设仍可自由改。不照搬「每轮写评估记录」。
- **落在哪层**：renderer `teamTemplates.ts`；Main `BOT_SUGGEST_PERSONA` 的提示词、`botPrompt.ts`（群主协议段落）。不改协议，不动已有成员的人设。
- **工作量**：S–M，2–3 人日。
- **风险**：低。人设变长会多占 token，需要控制在几百字以内；效果要用两家模型真机对比确认（越界和抢活是否减少）。Cumora 的教训是常驻提示一变长，撞车反而增多（塞进 5KB 规则后每局撞车从 0 次升到 1–3 次）：群主协议只写「形状级」短规则（它固定 5 条），以后不按单次事故往里加例子。

### 5. 辅助模型调用也入账（补 Cumora 后新增）

- **借鉴自**：Cumora 的 `llm_calls` 账本（每次调用含分诊都记用途、来源、token、成本、状态）和 CI 守卫 `guard-llm-tracked`。
- **现状缺口**：Bot 用量排行和日预算只读成员会话 jsonl（`botUsage.ts`）。智能选人、核心笔记重写、记忆整理、AI 生成人设都走 `completeText`（`src/main/services/agentHost.ts:1184`），不留用量记录。群里每条没有 @ 的人类消息都多一次选人调用，空闲 30 分钟的整理也在花钱，用量页和预算都看不到。
- **做什么**：Bot 侧调用 `completeText` 必须带用途（选人 / 笔记 / 整理 / 人设）和归属（成员或群）；用量追加写一份本地 jsonl（userData 下，不进 `settings.json`），`BotUsageService` 合并统计。用量页多一列「辅助调用」；归属成员的计入该成员日预算，选人这类群级调用单列。加一条测试守卫：Bot 目录里调用 `completeText` 不带用途就失败。
- **不做**：不新建配额面板，不做限额后自动回退（复用现有用量页和预算）；不改模型选择。
- **落在哪层**：Main 的 `completeText` 签名与调用点、`botUsage.ts`、bots IPC 的用量返回；renderer 用量页。
- **工作量**：S–M，3–4 人日。
- **风险**：低。旧数据没有辅助调用记录，只能从上线日起算；选人调用要不要计入某位成员的预算，需要拍板（待确认 6）。
- **为什么排在例程闸门前**：成本更低，而且是第 6 条的度量前提：先看清空转花了多少，再判断闸门值不值得做。

### 第 6 条（顺延出前 5）：例行任务前置检查闸门

- **顺延原因**：补 Cumora 后排到第 6。价值只体现在高频例程上，「检查命令是否只允许只读」也还没定（待确认 3）；第 5 条上线后能看到例程实际花了多少，再决定是否做。
- **借鉴自**：NanoClaw script gates、OpenClaw 条件触发。
- **做什么**：例程可以带一条可选的前置检查命令，在成员工作区里执行，超时 30 秒，输出上限 1MB，最后一行输出 `{"wake": boolean, "data"?: …}`。`wake=false` 就不唤醒成员、不花 token，运行历史记一条新结果 `skipped-precheck`；`wake=true` 时把 `data` 附进投递正文。检查命令算流程的一部分，修改会让 `procedureVersion` 加一，需要重新批准；保存时先用受保护动作分类器做静态检查，命中就拒绝。`routine_propose` 增加对应参数。适合「每 10 分钟看一次 CI 挂没挂」「目录有新文件才处理」这类高频巡检。
- **落在哪层**：shared 的 routine 类型与解析；Main `routineRunner.ts`（执行检查、结算）、`routineProposal.ts`；renderer `RoutineList` 编辑器。
- **工作量**：M，3–5 人日。
- **风险**：无人值守执行命令。缓解措施：人工批准 + 分类器 + 超时与输出上限 + 运行历史可见。脚本误判会漏报，历史里显示跳过次数便于发现。仍属于人批准的例程，不违背「不做无人触发讨论」。

### 第 7 条：成员提议技能草稿，人审后生效

- **顺延原因**：补 Multica 后排到第 6，补 Cumora 后再顺延到第 7。审核链路最长；而且以「沉淀成 playbook」为卖点的 Multica 也只做到人工整理和导入，说明自动提议还不是被验证过的刚需。
- **借鉴自**：OpenClaw Skill Workshop（提案 → 审阅 → 应用 → 回滚）、Hermes 的技能自动沉淀（只取「会沉淀」这一点，不取「自动改」）。
- **做什么**：新增 `skill_propose` 工具，和 `routine_propose` 一样只挂在成员自己的私聊 / 群聊会话里。成员完成复杂任务后可以提议一份 SKILL.md 草稿（名称、触发条件、步骤），进收件箱成为「待批准技能」卡片，显示内容 / diff 和注入扫描结果；批准后写进该成员的技能目录并加入他的技能列表，保留上一版用于回滚。不自动生效，不跨成员共享。
- **落在哪层**：agent 工具 + Main（技能存储、复用 `injectionScan`、收件箱新增一类）+ renderer 收件箱和资料页。
- **工作量**：M–L，5–8 人日。
- **风险**：技能质量参差、数量膨胀（需要限制每个成员的数量，并要求写清触发条件）；技能正文可能被注入（扫描 + 人审）；成员技能目录和 Code 的技能目录怎么共存，要先定规则。

### 第 8 条（补 Octop 后新增）：用户可编辑的持久命令规则

- **前置**：先做「本会话总是允许」收窄到命令前缀（S，1–1.5 人日，顺手项，不占排序），上线后看用户是否仍频繁选「完全放行」或反复批同一类命令，再决定是否做本条。
- **借鉴自**：Octop tool_guard 的「界面可编辑、保存前校验、热重载、恢复默认、审计」；dots 的允许 / 需审批 / 禁止三类规则。不取 Octop 的正则黑名单和全局单一动作。
- **做什么**：设置里一张规则表（命令前缀或通配 + 免审 / 必须确认 / 禁止），可从审批卡一键生成；优先级 禁止 > 受保护底线 > 必须确认 > 免审 > 会话白名单 > 档位，免审不能盖过底线，禁止在完全放行档也生效。
- **工作量**：M，约 4–5 人日。拆分见 ⑦ 节。
- **风险**：匹配写错就是安全漏洞（必须先写测试覆盖管道、`sh -c`、包装程序等绕过写法）；规则多了用户自己也看不懂为什么被拦，审批卡要显示命中的是哪条规则。

**排序说明**：1 和 4 成本最低，直接改善首跑和协作体验；2 防止长期知识出错又无法纠正，本来就是既定优先项；3 给看板补上「交还给人」和「卡住要人」两道口，直接对应项目经理派活、群聊任务板的日常流程；5 让用量和预算覆盖全部模型调用，成本低，也是判断第 6 条值不值得做的依据；例程闸门和技能草稿分别顺延到第 6、第 7，理由见各节；Octop 带出的持久命令规则排第 8，先做会话白名单收窄这一步。Cumora 里的新鲜度门、原子认领、小模型分诊，我们已用单一回复人、Main 单线程认领和智能选人覆盖，所以没有进前 5；Octop 的 memory slim 只借流程纪律并入 Top 2，功能不做。没进前 5 的借鉴项（事件前瞻提醒、一次性提醒、记忆导入、笔记容量可见、离线消息过期；Multica 的任务卡历次委派、触发预览与 `/note`、例程建看板任务、例程高失败率自动暂停；Cumora 的并行回复时追加新消息提示、认领失效提示、群聊协作回归脚本；Octop 的「本会话总是允许」收窄、纯提醒定时任务）都是 S–M 的小项，可以跟着相邻工作顺手做。

## 五、待确认

1. 用户的「Grok bot、dot」指的是 xAI Grok Bot + OpenAI dots（本报告的判断），还是 Clawdbot？两种理解都已覆盖，但会影响后续是否继续跟踪闭源产品的迭代。
2. Top 1、Top 2 是否直接并入既定两个优先项的排期，不单独立项？
3. 第 6 条（例程前置闸门）的检查命令要不要只允许只读命令（更安全，但用途变窄）？
4. （Multica）「待验收」只对人创建的任务生效，成员自建的子任务仍由发起成员核对，这个口径是否认可？
5. （Multica）委派时限从创建时起算，排队和等人回答都计入（`delegationService.ts:261`），这是有意为之还是缺陷？建议先由 Jason 写测试确认再决定。
6. （Cumora）Top 5 入账后，群聊选人这类群级辅助调用是只单列展示，还是按群主或被选中的成员计入日预算？
7. （Cumora）成员执行的 shell 命令是否继承了带 provider 密钥的环境变量？如果继承，按安全缺陷处理，建议先由 Jason 写测试确认。
8. （Octop）「本会话总是允许」收窄到命令前缀，是否按顺手项直接排期？收窄后，原来点一次就放开整个 shell 的用户会多被问几次，需要认可这个体验变化。
9. （Octop）第 8 条持久命令规则是只做全局，还是也允许按成员配置？以及是否同意「免审不能盖过受保护底线」作为硬原则。

## 来源

- OpenClaw：[仓库](https://github.com/openclaw/openclaw) · [文档索引](https://docs.openclaw.ai/llms.txt) · [Memory](https://docs.openclaw.ai/concepts/memory) · [Memory architecture](https://docs.openclaw.ai/concepts/memory-architecture) · [Dreaming](https://docs.openclaw.ai/concepts/dreaming) · [Provenance](https://docs.openclaw.ai/concepts/memory-provenance) · [Session](https://docs.openclaw.ai/concepts/session) · [Main session](https://docs.openclaw.ai/concepts/main-session) · [Session state](https://docs.openclaw.ai/concepts/session-state) · [Compaction](https://docs.openclaw.ai/concepts/compaction) · [Multi-agent](https://docs.openclaw.ai/concepts/multi-agent) · [Specialist lanes](https://docs.openclaw.ai/concepts/parallel-specialist-lanes) · [Broadcast groups](https://docs.openclaw.ai/channels/broadcast-groups) · [Ambient room events](https://docs.openclaw.ai/channels/ambient-room-events) · [Heartbeat](https://docs.openclaw.ai/gateway/heartbeat) · [Automation](https://docs.openclaw.ai/automation) · [Schedules](https://docs.openclaw.ai/automation/cron-jobs/schedules) · [Standing orders](https://docs.openclaw.ai/automation/standing-orders) · [Standing intents](https://docs.openclaw.ai/concepts/standing-intents) · [Skills](https://docs.openclaw.ai/tools/skills) · [Skill Workshop](https://docs.openclaw.ai/tools/skill-workshop) · [Pairing](https://docs.openclaw.ai/channels/pairing) · [iOS](https://docs.openclaw.ai/platforms/ios) · [Talk](https://docs.openclaw.ai/nodes/talk) · [Voice wake](https://docs.openclaw.ai/nodes/voicewake) · [Sandboxing](https://docs.openclaw.ai/gateway/sandboxing) · [Approvals](https://docs.openclaw.ai/cli/approvals) · [Onboard](https://docs.openclaw.ai/cli/onboard) · [Setup agent](https://docs.openclaw.ai/cli/openclaw) · [Doctor](https://docs.openclaw.ai/cli/doctor) · [改名史](https://en.wikipedia.org/wiki/OpenClaw)
- OpenGrokBot：[仓库 README](https://github.com/Z4YT0N/OpenGrokBot)
- Grok Bot：[Introducing Grok Bot](https://x.ai/news/introducing-grok-bot) · [Team Bots](https://x.ai/news/team-bots) · [产品页](https://x.ai/bot)
- dots / tots：[Introducing dots](https://openai.com/index/introducing-dots/) · [ChatGPT Learn: dots](https://learn.chatgpt.com/docs/dots) · [tots](https://tots.family/)
- Hermes Agent：[仓库](https://github.com/NousResearch/hermes-agent) · [Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) · [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- NanoClaw：[仓库](https://github.com/nanocoai/nanoclaw) · [Scheduled tasks](https://github.com/nanocoai/nanoclaw/blob/main/docs/scheduled-tasks.md) · [Isolation model](https://github.com/nanocoai/nanoclaw/blob/main/docs/isolation-model.md)
- nanobot：[仓库](https://github.com/HKUDS/nanobot) · [Memory](https://github.com/HKUDS/nanobot/blob/main/docs/memory.md)
- Multica：[仓库](https://github.com/multica-ai/multica) · [文档](https://multica.ai/docs) · [Core concepts](https://multica.ai/docs/concepts) · [How Multica works](https://multica.ai/docs/how-multica-works) · [Triggering](https://multica.ai/docs/triggering-agents) · [Assigning issues](https://multica.ai/docs/assigning-issues) · [Mentions](https://multica.ai/docs/mentioning-agents) · [Squads](https://multica.ai/docs/squads) · [Runs](https://multica.ai/docs/tasks) · [Issues](https://multica.ai/docs/issues) · [Inbox](https://multica.ai/docs/inbox) · [Autopilots](https://multica.ai/docs/autopilots) · [Skills](https://multica.ai/docs/skills) · [Daemon](https://multica.ai/docs/daemon-runtimes) · [Chat](https://multica.ai/docs/chat) · [Agents](https://multica.ai/docs/agents)
- Cumora：[仓库 README](https://github.com/yetone/cumora) · [COORDINATION](https://github.com/yetone/cumora/blob/main/docs/COORDINATION.md) · [BYOA](https://github.com/yetone/cumora/blob/main/docs/BYOA.md) · [SHIPPING](https://github.com/yetone/cumora/blob/main/docs/SHIPPING.md) · [LIMITS](https://github.com/yetone/cumora/blob/main/docs/LIMITS.md)（均为 main@6224983）
- Octop：[仓库 README](https://github.com/TencentCloud/Octop/blob/main/README_CN.md) · [memory-slim](https://github.com/TencentCloud/Octop/blob/main/docs/memory-slim.md) · [expert-teams](https://github.com/TencentCloud/Octop/blob/main/docs/expert-teams.md) · [personas](https://github.com/TencentCloud/Octop/blob/main/docs/personas.md) · [acp](https://github.com/TencentCloud/Octop/blob/main/docs/acp.md) · [agent-delegation](https://github.com/TencentCloud/Octop/blob/main/docs/agent-delegation.md) · 源码 `src/octop/api/routers/security.py`、`src/octop/infra/agents/security/`、`src/octop/infra/cron/tools.py`（均为 main@4b17f1c）；octop-harness：[仓库](https://github.com/TencentCloud/octop-harness) · `src/octop_harness/security/tool_guard/`、`src/octop_harness/middleware/tool_guard.py`（main@14a1cd9）
