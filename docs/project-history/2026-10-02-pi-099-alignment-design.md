# pi 0.99 对齐设计：codemode / tool_search / exposure

状态：已实现。分支 `feat/pi-codemode-align`（基于 #115 的 pi 0.99.2 升级）。

## 目标

把 Enso 自研的「工具编排」层换成 pi 0.99 的原生能力：

- `exec`（`isolatedSandbox.ts`）→ pi `codemode`
- 按需 MCP 的 `mcp` 代理工具（`mcpProxy.ts`）→ MCP 工具以 `exposure` 注册，由 `codemode` / `tool_search` 触达
- 嵌套调用改走 `ctx.executeTool` 管线（`parentToolCallId` 事件、`nestedCalls`、用量计入父调用）

## 关键取舍：MCP 连接层保留 Enso 自研

调研结论（pi 0.99.2 源码）：

| 问题 | pi 内置 mcp 扩展 | 影响 |
|---|---|---|
| 连接状态 | 只在扩展闭包内，`mcp_servers_change` / `getMcpServers()` 只给注册记录 | 设置页、`mcp-status` 无结构化来源 |
| OAuth 凭据 | `McpOAuthCredentialStore` 未从包入口导出，只能鸭子类型 + 断言 | 每次升级都可能静默坏 |
| 工具装饰 | 工具由扩展自己注册，不经 Enso 的 `withApproval` / `withPlanGate` / runaway / 输出预算 / reminders | 审批与计划门需整体改写为 `tool_call`/`tool_result` 钩子 |
| `auth.provider` | 401 不刷新，直接 needs-auth | 长会话失效 |
| 传输 | 无 SSE | 需删 SSE |

因此：**执行与暴露层对齐 pi（codemode / tool_search / exposure / executeTool），连接与认证层保留 `src/agent/mcp.ts`**。MCP 工具由 Enso 以 `customTools` / `pi.registerTool` 注册，带 `exposure`、`namespace`、`annotations`，继续经过现有装饰器。SSE、OAuth 回写、`mcp-status` 全部不变。

pi mcp 扩展不加载（不传入 `createMcpExtension`），避免读 `mcp.json`、写 `mcp-auth.json`。

## 行为变化

| 现在 | 之后 |
|---|---|
| 工具 `exec`，Enso QuickJS 沙箱 | 工具 `codemode`，pi QuickJS worker；`store` 持久化到会话（跨恢复/分支） |
| 常驻 MCP：直接声明 | 不变：`exposure: 'direct'` |
| 按需 MCP：一个 `mcp` 代理工具（list/describe/call），目录冻结在描述里 | 真实工具以 `exposure: 'deferred'` 注册（不进 codemode 描述，描述稳定利于缓存），脚本内 `searchTools` / `describeNamespace` 发现；服务器列表放 system prompt 段 `mcp_servers`（仿 pi） |
| 嵌套调用无事件，结果是 exec 自定义 JSON | 嵌套调用发 `tool_execution_*`（带 `parentToolCallId`），id 形如 `parent/1` |
| 嵌套调用上限 64、30s 超时、禁用工具清单、拒收 shell/apply_patch 文档 | 同等限制改为 Enso 内联扩展的 `tool_call` 钩子：注入 `// @options timeout_ms`、按父 id 计数拦截、拦截禁用工具、拦截 shell/patch 文档 |
| — | `codemode` 的 `models` 关闭（不允许脚本用宿主凭据调模型） |
| 历史会话里的 `exec` / `mcp` 记录 | 继续按旧渲染显示（只读兼容） |

按需服务器保持「启动不连接」：首次 `codemode`（关闭沙箱时为 `tool_search`）调用前，在 `tool_call` 钩子里连接（每个 server 20s 预算），连上后 `pi.registerTool` 动态注册；失败的 server 下次调用重试。

`codemode` 关闭但有按需 server 时，改为激活 `tool_search`，模型检索后直接调用。两者都在注册时激活（`defaultActive: true`），不依赖会话创建后的 `setActiveTools`。

装饰器（引用、输出外置、runaway、system reminder）对嵌套调用（id `<parent>/<n>`）跳过：结果只进脚本，避免提醒被吞、输出被外置成路径；审批与计划门仍生效。

Enso 扩展排在 `extensionFactories` 首位，保证 `mcp_servers` 段写入先于 persona 等强制 system prompt 的处理器。

## 所属层与必改文件

- agent（worker）
  - 新增 `src/agent/codemodeIntegration.ts`：内联扩展（加载 `createCodemodeExtension({models:false})`、`createToolSearchExtension()`、`tool_call` 防护钩子、`mcp_servers` 段、按需连接等待）
  - `mcp.ts`：工具定义增加 `exposure` / `namespace` / `annotations` / `structuredContent`
  - `supervisor.ts`：父/子会话装配；`defaultTools` 激活 `codemode`（`tool_search` 仅有 deferred 时）；嵌套 `tool_execution_*` 事件按 `parentToolCallId` 处理
  - 删除 `isolatedSandbox.ts`、`mcpProxy.ts` 及测试
  - `childProfileTools.ts` / `builtinTools.ts`：`exec` → `codemode`（开关 id `isolated_sandbox` 保留以兼容设置）
  - `builtinOccupancy.ts`：占用估算按 codemode 描述
- shared：嵌套 id 判定改为同时识别 `parent/n`
- renderer
  - `timeline.ts` / `TimelineRow.tsx`：新增 `codemode` 卡片（源码 + 嵌套调用列表来自 `details` / 嵌套事件）；保留 `exec`/`mcp` 历史渲染
  - `ApprovalBar.tsx`：嵌套判定兼容 `/`
  - i18n、能力目录、设置页文案
- Main：无协议变化（`McpServerSpawnConfig`、OAuth、`mcp-status` 不动）
- 打包：确认 `pi-codemode` 的 worker 文件与 `quickjs-wasi@3.6.2` 的 wasm 进入安装包

## 顺带纳入的 0.99 新能力

| 能力 | 处理 |
|---|---|
| MCP `structuredContent` / `outputSchema` | 纳入：脚本拿到完整 `CallToolResult` |
| 工具 `namespace`（`mcp__<server>`） | 纳入：`describeNamespace` 可用 |
| 工具 `annotations` | 仅透传；不用于自动放行（`readOnlyHint` 不能当安全依据） |
| `codemode` `store` 持久化 | 随 codemode 获得 |
| OpenAI「Sign in with ChatGPT」 | 纳入：Main 持久化 `deviceId`（UUID，非密钥）传 `getDeviceId`；已有 `openai` API key 时 OAuth 账号用独立键，修复现失败测试 |
| Virtual Models / Classifier / 图片生成 | 不做：需产品设计（路由策略、UI、计费展示） |
| pi 内置 mcp（resources 工具、`/mcp` 登录） | 不做：见上方取舍 |

## 明确不做

- 不改 MCP 配置模型、`loadMode` 语义、OAuth 存储、`mcp-status` 协议、SSE。
- 不把审批迁到钩子层（MCP 工具仍由 Enso 注册并装饰）。
- 不改 typed agent 的 MCP binding 证明逻辑（仍是常驻工具）。

## 验证

- 单测：防护钩子（超时注入、计数、禁用工具、shell/patch 拦截）、按需注册与等待、嵌套事件投影、历史 exec 渲染。
- 全量 `pnpm typecheck && pnpm lint && pnpm test`。
- 真机：至少两个厂商模型（Anthropic + OpenAI/Gemini）跑 codemode 调用常驻/按需 MCP、审批弹窗出现在嵌套调用、计划模式拦截嵌套写入；打包后 codemode 可用。

实测（隔离 userData）：claude-opus-5-5 与 grok-4.6 各一次 codemode 调用，按需 server 首次调用才连接并被 `searchTools` 找到、常驻 server 工具在脚本内可调，脚本内调用 `todo` 被拦截；`build:mac:dir` 产物内含 pi-codemode worker 与 quickjs-wasi 3.6.2，Electron 43 utilityProcess 可从 asar 启动 ESM worker。
