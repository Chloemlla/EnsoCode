# Plan 模式（P1 已实现）

## 参考结论

| 来源 | 形态 | 只读限制 | 计划产物 | 审批 / 执行 | 可取 | 坑 |
| --- | --- | --- | --- | --- | --- | --- |
| pi-desktop | Agent/Plan/Goal 三态 chip，同一 agent 的会话状态 | runtime 隐藏 + host 权威 deny + sidecar 兜底；Bash 不判只读 | `SubmitPlan{title,markdown,question}`，`terminate`，落 `.pi/plan/*.md` 不可变 + sha256 | 审批条 Approve（下拉选批准后权限模式）/Reject；批准以内部 user 消息注入全文 | 三层工具门、批准同时选权限、内部消息注入 | Bash 可写；本地工具绕过权限中心；无步骤进度；四份派生态易漂移 |
| deepseek-harness | `/plan` 布尔态，日志折叠，无活镜像 | 不强制，纯提示词；工具目录跨模式恒定保 cache | `exit_plan_mode{plan}`，不落盘，计划在 tool 参数里 | 走 user-question 通道，拒绝=抛错带反馈；plan 与 todo 职责分离 | 状态=日志折叠；工具目录不变；“口头同意不算批准” | 非安全边界 |
| deepchat | 无 Plan 模式，只有 `update_plan` 进度清单 | 无 | 全量快照 + revision + terminalReason | 无审批 | 中断时收敛 in_progress | 重启丢浮层 |
| pi 官方 example / oh-my-pi | `/plan` + 快捷键 | setActiveTools 差量 + bash 正则白名单 | 散文 `Plan:` 正则抽取 / oh-my-pi 落 `local://` 文件 | TUI select；`[DONE:n]` 进度；oh-my-pi 有压缩保护、清上下文执行 | 恢复逻辑、压缩保护 | 正则解析脆；依赖 TUI |
| npm 社区（plannotator 7.7万/月、narumitw 2.9万、janvitos 1.2万、pify） | `/plan` | narumitw 纯白名单拦截；pify allow/confirm/block 三级 + 委派工具边界判决 | 专用提交工具 + `terminate:true`；部分落文件 | plannotator 批注反馈格式；Implement here / fresh session；反馈作为 tool result | append-only 注入 + countermand（plannotator #1380：删历史注入让 cache 失效）；压缩后补注入活计划 | 每轮改 system prompt 破 cache；只靠提示词约束 bash |

## 行为差距与所属层

审批档位只管单次工具调用，todo 只记进度，`/goal` 只管自动续跑；缺“只读调研 → 冻结计划 → 用户审批 → 执行”。Plan 是 Composer 的开关（不替换 `/goal`），worker 硬拒写工具，模型用 `submit_plan` 提交后本轮结束，用户在审批条批准 / 提修改意见 / 放弃。

| 层 | 文件 | 职责 |
| --- | --- | --- |
| shared | `planMode.ts`、`readOnlyCommand.ts`、`types/agent.ts`、`types/ipc.ts` | 条目解析、`foldPlanState`、注入文本与前缀拆分、只读命令判定、命令 / 事件 / 快照协议 |
| worker | `agent/planMode.ts`、`supervisor.ts`、`approval.ts` | `PlanController` 状态机、`withPlanGate` 工具门、`submit_plan`、提示前置、回退 / 压缩 / 冷恢复 |
| Main / preload | `main/ipc/agent.ts`、`agentHost.ts`、`preload/index.ts` | `set-plan-mode`、`plan-respond` 两个 IPC，spawn 透传 `planMode` |
| renderer | sessions store / reducer / timeline、`PlanModeToggle`、`PlanBar`、`TimelineRow`、`ApprovalBar` | 投影、开关、审批条、执行条、计划卡片、`/plan` |

## 核心决策

1. **同一 agent 的会话状态**：模型、上下文、工具目录都不变。
2. **jsonl 是唯一权威**：custom entry `enso-plan` 记录全部状态，按当前 branch 折叠；spawn / 冷恢复 / 回退 / fork 天然一致，renderer 只存投影（未 spawn 时记期望开关，spawn 时以 `planMode` 下发）。
3. **工具目录跨模式恒定**：不用 `setActiveToolsByName`（重建 system prompt 破 cache），也不用 pi `tool_call` hook（exec 沙盒直调 `definition.execute` 会绕过）；`withPlanGate` 包在父会话工具最外层，沙盒 catalog 用的也是包过的定义。
4. **提示只追加**：状态变化记一条待告知提示，前置到下一条进入模型的用户消息（`<plan-mode>` ON/OFF、压缩后 `<active-plan>`）；不改 system prompt、不删历史、不挂在工具结果里（避免 UI 工具输出里出现大段规则）。模型未被告知前开了又关不产生提示；冷恢复 / 回退后处于规划中就重申一次。
5. **提交不阻塞**：`submit_plan` 返回 `terminate:true`，不像 `ask_user` 挂起 turn，重启后待审计划仍可恢复。
6. **执行进度复用 todo**；规划期禁用 todo，避免污染 TodoBar。

## 状态模型

```ts
// custom entry 'enso-plan'，严格解析，坏条目与过期 planId 跳过
| { v: 1; kind: 'mode'; active: boolean; at }
| { v: 1; kind: 'submitted'; planId; title; text; at }          // 仅 active 时生效
| { v: 1; kind: 'resolved'; planId; action: 'approved' | 'revised' | 'discarded' | 'superseded'; at }
| { v: 1; kind: 'finished'; planId; at }

PlanState = { active; pending?: PlanDoc; executing?: PlanDoc; resolutions: Record<planId, action> }
phase = pending ? awaiting_review : active ? planning : executing ? executing : off
```

- 待审时用户直接发消息（`prompt` / `steer` 命令）→ `superseded`，继续规划；worker 内部通知不触发。
- 待审时关闭 Plan / 点「放弃并退出 Plan」→ `mode:false`，折叠为 `discarded`。
- 批准 → `approved`，`active=false`，进入执行态并以 `<plan-approved>` 新消息发出全文；再次进入 Plan、点执行条的结束，或轮次正常收尾时批准后建过 todo 且最新清单全部完成（worker 自动写 `finished`；中断 / 出错的轮不算，没建 todo 则留给用户手动结束），退出执行态。
- 修改意见 → `revised`，以 `<plan-feedback>` 新消息发出，模型需提交完整修订版。

## 工具门（planning / awaiting_review 生效）

| 工具 | 行为 |
| --- | --- |
| read / grep / find / ls、browser、memory、ask_user、explore_*、goal_* | 放行 |
| edit / write / apply_patch、todo、workflow | 硬拒，错误文本提示继续只读调研并 `submit_plan` |
| bash / MCP | 按当前审批档走常规审批（完全放行即直接执行）；不改文件只靠 `<plan-mode>` 提示约束 |
| subagent | spawn 只允许 `tools:'readonly'` 类型；wait / report / list / stop / dismiss 放行；send / message 拒绝 |

最初对非只读 bash 与 MCP 不论审批档强制问人；但规划期常需跑测试、类型检查，完全放行档下反复询问等于推翻用户的档位选择，已改为尊重审批档，代价是模型理论上可经 bash 改文件。

已在运行的可写子代理不受父会话 Plan 约束（P1 不处理）。

## UI

- Composer 工具行「计划」开关，开启时边框高亮、占位「描述任务，先产出计划」；`/plan [任务]` 开启并发送，`/plan off` 关闭。
- 审批条（待审时）：标题 + Markdown 预览，「放弃并退出 Plan」「修改意见」「批准并执行 ▾」（下拉选执行时的审批档位）；输入框不锁。
- 执行条：「执行计划 {title}」，可展开全文、可结束；todo 全部完成后自动收起。
- 时间线：`submit_plan` 渲染为可展开计划卡片且不被过程折叠吞掉；Plan 提示前缀渲染为系统行；批准消息渲染为「已批准计划」系统行；修改意见渲染为带标签的用户气泡；回退回填时去掉前缀。

## 验证记录

- 单测：`shared/planMode.test.ts`、`shared/readOnlyCommand.test.ts`、`agent/planMode.test.ts`、`approval.test.ts`、reducer / timeline / store 用例。
- 真机（CDP，隔离 userData）：claude-sonnet-5 与 deepseek-v4-pro 各走通「进入 → 调研 → submit_plan」；Claude 走通修改意见 → 修订 → 批准（完全放行档）→ 执行改文件并跑测试；DeepSeek 验证 Plan 中 apply_patch 被拒、待审发消息取代计划、重启冷恢复后重申规则并重新提交、放弃后 OFF 提示与正常改文件；冷会话点执行条结束会先恢复再下发。

## 后续（未做）

- P2：编辑后批准、批注式反馈（plannotator `## n. (lines a–b) … > comment`）、新会话 / worktree 执行、批准并设为 Goal、导出 Markdown、手机端审批、设置里关闭 Plan 能力。
- P3：规划 / 执行分模型、模型自主 `enter_plan_mode`、只读 MCP 白名单、运行中可写子代理的处理。
- 不做：Rust host / DB 审批表 / 超时；默认把计划写进仓库；步骤级调度器；按模式切换 active tools；每轮改 system prompt。
