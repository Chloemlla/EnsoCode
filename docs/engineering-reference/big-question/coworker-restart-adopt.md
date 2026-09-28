# 重启后 subagent 雇的 coworker 找不回来

## 症状

- 应用重启后 coworker 的 tab 还在，但 `subagent list` 返回空，给原 agentId `send` / `message` 报 `not-found: Agent was not found in this owner.`
- 只在真机出现；AgentService 的 adopt 单测全绿。

## 根因

- Main 重启后只看 `settings.json` 里落盘的 child metadata：`dispatchOrigin === 'agent-tool' && mode === 'coworker'` 才调 `adoptCoworker`。
- 这份 metadata 由渲染层落盘。Main 预约时下发的 `child-reserved` 是对的，但 worker 回流的 `coworker-update` / snapshot 自带一份：`dispatchOrigin` 写死 `typed-mention`，不带 `mode`。渲染层合并时直接覆盖（snapshot 整个替换；coworker-update 只补了 mode，换代分支连 mode 也没补），落盘后就不再是 agent-tool coworker。
- 就算认领了，adopt 以 instanceId 作 agentId，而 spawn 回给模型的是另一个随机 UUID，模型手里的 id 照样失效。

## 修法

- 渲染层 `withMainChildMetadata`：合并 worker 回流的 metadata 时，同一 instance 的 `dispatchOrigin` / `mode` 沿用已有值（来自 Main 预约或上次落盘）。coworker-update 同代、换代和 snapshot 三处都走它。
- `AgentService.spawn` 以子会话 instanceId 作 agentId。
- 不改 worker：worker 用 `dispatchOrigin === 'typed-mention'` 决定不另发「Coworker finished a round」通知，改成 agent-tool 会给子代理多发一遍。
- 修复前已落盘成 typed-mention 的子会话无法还原，重启后仍不会被认领。

## 回归防线

- `src/renderer/stores/sessions/index.test.ts`：「worker 回流的 metadata 来源恒为 typed-mention、不带 mode：落盘仍是 Main 预约的 agent-tool coworker，重启换代后也是」。
- `src/main/services/agentService.test.ts`：「agentId 取子会话 instanceId：Main 重启后按 instanceId 认领，模型手里的 id 照样能用」。
- 真机：spawn 两个 coworker 后连续重启两次，`list` 仍是原 agentId，给原 id `send` 带 `wait:true` 正常返回，`settings.json` 里的 child 仍是 `agent-tool` + `coworker`。只重启一次测不出换代分支的问题。

## 相关代码

- `src/renderer/stores/sessions/index.ts`：`withMainChildMetadata`，`coworker-update` / `snapshot` 处理
- `src/agent/supervisor.ts`：`spawnTypedChild` 自建的 metadata
- `src/main/services/agentDispatchService.ts`：`restoreChildren` → `reserveChildResume`
- `src/main/ipc/agent.ts`：`child-ready` 上的认领条件
