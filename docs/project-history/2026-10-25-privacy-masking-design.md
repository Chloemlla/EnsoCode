# 内置隐私脱敏设计

参考 magpie `internal/redact`：发往模型前把密钥 / 个人信息换成占位符或假 key，回包流式还原。默认关闭。

## 拦截层

worker 共享 `ModelRuntime` 是唯一出口（会话、compaction、cache warmer、Main `completeText` / `classifyChoice`）。
在 `supervisor.getRuntime()` 包实例的 `stream` / `streamSimple`，操作 pi 归一化的 `Context` 与 `AssistantMessageEvent`，与厂商协议无关。
不在 provider 层包：`withRequestBodyBudget` 只覆盖部分 provider。虚拟模型由 runtime 内部递归到真实模型时再脱敏，外层放行。

## 机制

- 占位符 `{{KIND_xxxxxxxx}}`，8 位为 HMAC-SHA256(key, kind\0value) 的 base32；key 存 `agentDir/privacy-mask.key`（0600）。同值同占位符，保 prompt cache 与签名。
- Shape：密钥按前缀 / 长度 / 分隔符 / 字符类保形生成假 key；≥8 字符且 ≥6 位可替换，否则退回占位符。
- 原值只在 worker 内存，按插入序淘汰。Main / renderer 只见报告（kind、规则、动作、位置、指纹、`sk-…(51)` 形式 preview），绝不含原值。
- 出站：systemPrompt、user / toolResult 文本、assistant text 与 toolCall 参数、tools description；thinking 只替换已知值。id、工具名、schema、图片、签名不动。
- 入站：重建 partial / content / toolCall / message；delta 末尾疑似半个占位符或已知假 key 前缀时扣留，`*_end` 冲刷。
- 脱敏异常返回不可重试的错误流，绝不明文回退。

## 动作

- mask：替换；warn：原样发出并记录；block：
  - 用户输入在 renderer 乐观回显前用共享规则预检拒绝；
  - 其余位置在 worker 返回错误流。被拦过的值记入已拦集合，之后改为脱敏发送（不卡死会话）。

## 记录与展示

- `privacy-mask` AgentEvent 实时推送；会话内 `enso-privacy-mask` custom entry 紧跟 assistant 消息持久化；会话外调用写 Main `userData/privacy-mask/ledger.jsonl`，保留 30 天。
- 设置「隐私」页：规则配置、试一试（共享纯函数 + 非密码学哈希，不经 worker）、记录汇总。
- assistant 消息盾牌徽标，按最重动作着色。

## 决定

- 一期覆盖密钥 + 个人信息 + 自定义词；Bot 与辅助补全一并覆盖。
- 设置不参与 configSync（自定义词本身可能敏感）。

## 不做

图片文字、本地 PII 模型、本地 provider 免脱敏、webSearch 直连 query、合并现有三处单向打码。
