# 虚拟模型与分类器路由设计

状态：已确认（采用「待确认」中的建议答案）。分支 `feat/virtual-models`（基于 `205da07fb`）。

## 目标

让用户在模型选择器里选一个「Auto」类虚拟模型。每次请求由路由器挑一个真实模型（及思考档位），覆盖三类真实需求：

1. **故障转移**：主模型限流 / 过载 / 5xx 时自动换备用模型，不用手动切。
2. **按能力补位**：带图片而主模型不支持图片、上下文超出主模型窗口时，换能接住的成员。
3. **按难度分档**（第二阶段）：分类器判断新一轮用户请求的难度，简单问题走快模型，复杂任务走强模型。

## 关键事实（pi 0.99.2）

- `modelRuntime.registerVirtualModel({provider, id, name, contextWindow, maxTokens, input, thinkingLevels, route})`。会话选中的始终是虚拟模型（`session.model`、扩展里的 `ctx.model`，`api: 'pi-virtual'`）；每条 assistant 消息记录真实 provider/model/thinkingLevel；`session.routedModel` 是最近一次成功响应的真实模型。
- 每次请求调用 `route(request)`，`reason` 为：
  - `user`：新一轮用户输入后的首个请求；
  - `continuation`：同一轮工具结果后的续请求；
  - `retry`：pi 自身重试（仅可重试错误：限流/过载/5xx/网络），带 `failed{model, message}`；
  - `direct`：压缩摘要、扩展的 `streamSimple`/`completeSimple`。
- 路由器状态（JSON）作为 `pi.virtual-model-state` 条目写在分支上，跟随 fork/tree，压缩后保留。
- 续请求返回 `previous` 才能保住 prompt cache 和 thinking 签名；换模型 = 缓存全失。
- 上下文上限：首个响应前用虚拟模型声明的 `contextWindow`，之后用 `routedModel`；路由到窗口更小的模型时 pi 会先压缩再发。
- `modelRuntime.stream/complete`（非 simple）遇到虚拟模型直接抛错，只有 `streamSimple/completeSimple` 会按 `direct` 路由。
- 恢复会话时若虚拟模型未注册，pi 回退到最后一个真实模型（不报错，静默）。
- 分类器：pi-ai `ClassifierModel`（`type: 'classifier'`），`modelRegistry.classify(model, {state, questions})` 返回 choice/score/bool 答案与置信度。现有 api 只有 `typesafe-system-one`（typesafe / openrouter / opencode / vercel-ai-gateway）、`cloudflare-workers-ai-system-one`、`llama-cpp-classify`，模型来自在线 catalog。API 标注 experimental。

## 方案总览

分两个 PR：

| 阶段 | 内容 |
|---|---|
| PR1 虚拟模型 + 规则路由 | 设置项、选择器、Main 解析下发、worker 注册与路由、下游适配；路由只用确定性规则（故障转移、图片、上下文、direct 走快模型） |
| PR2 分类器分档 | 新一轮 `user` 请求先分类再选档；分类器来源二选一：pi 分类器模型，或「快聊天模型当裁判」；超时/失败回退规则结果 |

两阶段共用同一个路由函数，PR2 只是在 `reason === 'user'` 时多一个输入。

## 数据模型

```ts
// shared/types/virtualModels.ts
interface VirtualModelEntry {
  id: string;            // 稳定 uuid，作为 modelId
  name: string;          // 显示名，如 "Auto"
  enabled: boolean;
  primary: DefaultModelRef;        // 默认成员（强模型）
  fast?: DefaultModelRef;          // 快/便宜成员：direct 请求、PR2 的简单档
  fallbacks: DefaultModelRef[];    // 故障转移顺序
  classifier?: VirtualClassifierConfig; // PR2
}
```

- 引用编码：`{providerId: 'enso-virtual', modelId: entry.id}`，`VIRTUAL_PROVIDER_ID` 常量放 `shared/defaultModel.ts` 旁。现有所有 `DefaultModelRef` 存储位（会话 last、项目/分组/全局默认）无需改形状。
- settings 新字段 `virtualModels: VirtualModelEntry[]`：只有引用、无密钥，走普通白名单字段，不进 PROTECTED；本期不进 configSync。
- 成员限制：不能是虚拟模型（不嵌套）、不能是 Cursor provider（Cursor 走 sessionBridge 直调工具，不经 pi 请求管线）。成员之间允许跨 provider、跨 api。

## 各层改动

### shared
- `modelUsability`：虚拟引用可用 ⇔ 条目启用且 `primary` 可用；不可用的 fast/fallback 在解析时剔除并记 warning，不阻断。
- 新 `resolveVirtualMembers(entry, providers)`：返回可用成员去重列表（primary 在首）。
- 虚拟模型声明能力：`contextWindow` / `maxTokens` 取可用成员最小值（保证首个请求前占用估算不过乐观），`input` 取并集（图片由路由补位），`thinkingLevels` 取 primary 的。

### Main
- `resolveModelSelection`：虚拟引用解析成新的 `SpawnModelConfig` 变体
  `{kind: 'virtual', settingsProviderId: 'enso-virtual', modelId, name, members: SpawnModelConfig[] (含各自 key/OAuth 账号), roles: {primary, fast?, fallbacks[]}, classifier?}`；
  `parseSpawnModelConfig` 同步支持并严格收窄。
- 辅助模型（标题、记忆提炼、代审、smartCompactModel、语音纠错、btw）：选择器里不出现虚拟模型；回退链落到虚拟引用（如 defaultModel 为 Auto）时取其 `fast ?? primary`。集中在一个 `physicalRefFor(ref)` 里，各调用点只换一行。
- 子代理可选模型（`subagentModels`）、typed agent `fixed` 模型：本期不允许选虚拟；`follow` 父会话时继承虚拟（同一 worker runtime 已注册）。
- 配对手机端 `set-model`：`pairPolicy` 允许虚拟引用（与桌面同一校验）。
- 用量统计不改：jsonl 里本来就是真实模型，定价照旧按真实 model id。

### Worker
- 新 `src/agent/virtualModels.ts`：
  - `registerEnsoVirtualModel(runtime, config)`：逐成员走现有 `resolveBaseModelOrRefresh`（注册 provider、OAuth 账号），再 `runtime.registerVirtualModel({provider: 'enso-virtual', id, name, …, route})`；重复注册即替换，设置变更在下次 `set-model` / spawn 时生效。
  - `routeRequest(request, roles)` 纯函数（单测主体），规则按序：
    1. `direct` → `fast ?? primary`（摘要不需要强模型）。
    2. `retry` → `failed` 之后的下一个成员（primary → fallbacks 顺序），state 记 `failedOver`；无可用成员时返回 failed 本身让 pi 按原逻辑报错。
    3. `continuation` → `previous`（保缓存）；但若最新工具结果带图片且 previous 不收图片，换收图片的成员。
    4. `user` → 默认 `primary`；若本轮用户消息有图片而 primary 不收图片，换第一个收图片的成员；若估算上下文 > 当前成员窗口，换窗口足够的成员。state 里的 `failedOver` 在新一轮 `user` 时清掉，重新尝试 primary。
    5. 思考档位：会话选择的档位按目标成员 `thinkingLevels` 夹取。
  - 只有 primary 可用时也照常工作（等价于单模型）。
- 调用点适配：
  - `set-model` / spawn：虚拟配置先注册再 `session.setModel`；`applyReasoningToModel` 作用于各真实成员，而不是虚拟模型对象。
  - 恢复会话：spawn 时注册虚拟模型必须早于 `createAgentSession` 恢复分支，避免 pi 静默回退到真实模型。
  - `ensoCompact`：摘要调用改用 `completeSimple`（或在未配置摘要模型且 `ctx.model` 为虚拟时先取 `routedModel`），否则 `modelRegistry.complete` 遇虚拟直接抛错。
  - `codexCompact`：按 `routedModel` 判断是否 Codex。
  - continuousMemory 阈值、`occupancyFromManaged`、`positiveContextWindow`：改用 `session.routedModel?.model ?? session.model`。
  - `model-changed` 仍上报设置引用（虚拟）。实际路由到的模型不新增事件：assistant 消息本来就记录真实 model，renderer 直接取最近一条回复的 model 显示。
  - adaptive thinking：pi 按目录模型副本发出路由后的请求，会话里就地改 `compat.forceAdaptiveThinking` 对成员无效；改在 `resolveBaseModelOrRefresh` 给 anthropic-messages provider 套出口包装，只给未显式设置的推理模型补上（直连会话已显式设置，结果不变）。
  - Codex 远端压缩（codexCompact）按 `ctx.model.api` 判断，虚拟模型下不走，统一用 ensoCompact。

### Renderer
- `ModelPicker`：顶部新增「虚拟模型」分组，仅在 `allowVirtual` 时显示（composer、全局/项目/分组默认、BtwView 不显示）。
- 设置页：「模型」下新增「虚拟模型」卡片，编辑名称、主模型、快模型、备用列表（复用 ModelPicker，`allowVirtual=false`、排除 Cursor），PR2 再加分类器配置。
- 显示：composer 模型按钮显示 `Auto · claude-opus-5-5`（最近一条回复的真实模型）；时间线回复头本来就是真实模型名，首个 step 失败被重试时改用随后成功那条的模型；状态栏、coworker 头、任务栏按虚拟模型名显示。
- 占用环用 routed 窗口。

## PR2：分类器

```ts
interface VirtualClassifierConfig {
  source: 'pi-classifier' | 'judge';
  model: DefaultModelRef;   // pi 分类器模型，或做裁判的快聊天模型
  timeoutMs: number;        // 默认 3000，超时用规则结果
}
```

- 只在 `reason === 'user'` 时分类一次，结果写入 state（`tier: 'simple' | 'complex'`，置信度），续请求沿用 previous，不额外调用。
- 输入：本轮用户消息（截断 4KB）+ 上一轮结论 + 是否带图/是否处在计划模式。计划模式直接判 complex，不调用分类器。
- `pi-classifier`：`classify(model, {questions: {complexity: {type: 'choice', criteria: {simple, complex}}}})`，complex 概率 ≥ 0.5 走 primary，否则 fast。要求用户配置了支持分类器的 provider（OpenRouter / TypeSafe 等），catalog 里 `type === 'classifier'` 的模型才出现在选项里。
- `judge`：用 `completeSimple` 让快聊天模型输出单个 token（`SIMPLE`/`COMPLEX`），`maxTokens` 8、无思考；适配用户现有的 anthropic/openai 兼容代理，不需要额外凭证。
- 分档换模型会丢 prompt cache：同一会话相邻两轮档位不同才换，且 `simple→complex` 立即换、`complex→simple` 需要连续两轮 simple 才换（滞回），避免来回抖。
- 成本与延迟：分类在首 token 前同步执行，上限 `timeoutMs`；分类用量单独记一条（不进主对话 usage 统计口径，日志可见）。

## 明确不做

- 不支持虚拟模型嵌套、不支持 Cursor 成员。
- 子代理可选模型 / typed agent 固定模型 / workflow 模型枚举本期不出现虚拟模型。
- 不做按工具阶段切换（pi 示例 jev-router 的「首次编辑后切便宜模型」）：一轮内换模型丢缓存，收益不确定。
- 不进 configSync、不导入其他应用的路由配置。
- 不做图像生成。

## 风险

- API 标注 experimental，pi 升级可能改字段；路由逻辑集中在 `virtualModels.ts` 一个文件，`route` 只依赖 `VirtualRouteRequest`。
- 401/鉴权错误不会触发 pi 的 retry 路由，故障转移只覆盖可重试错误；鉴权失败照常报错让用户处理。
- 成员任一 provider 的 key 变化需重新下发配置：沿用现有「设置变更后下次 set-model/spawn 生效」语义。
- 恢复会话时 Main 必须能解析出虚拟条目；条目被删后，pi 回退到分支里最后一个真实模型（默认行为），composer 随 `model-changed` 显示该真实模型。

## 验证

- 单测：`routeRequest` 全分支（direct/retry 链/continuation 保持/图片补位/上下文补位/档位夹取/滞回）、`modelUsability` 与 `resolveVirtualMembers`、`parseSpawnModelConfig` 虚拟变体收窄、辅助模型 `physicalRefFor`、ensoCompact 在虚拟模型下的摘要模型选择。
- 全量 `pnpm typecheck && pnpm lint && pnpm test`。
- 真机（隔离 userData + fake provider 制造 429）：主模型 429 时自动切备用并在回复头标记；带图消息切到收图成员；压缩摘要走快模型；恢复会话仍选中虚拟模型；两个真实厂商（Anthropic + xAI）作为成员混用一轮。PR2 另测 judge 分类的分档与滞回。

## 待确认

1. 分两个 PR（先规则路由，再分类器）是否可以？
2. 分类器默认来源：`judge`（用现有快模型，零额外凭证）还是 `pi-classifier`（需 OpenRouter/TypeSafe）？建议默认 judge，两者都支持。
3. 子代理 / workflow 本期不能选虚拟模型，是否接受？
4. 默认是否内置一个「Auto」条目（用当前默认模型做 primary，无 fast/fallback），还是完全由用户新建？建议不内置。
