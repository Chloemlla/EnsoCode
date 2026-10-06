# 群聊话题（可来回切换的多条对话）设计

## 目标

群聊可以开多个「话题」，每个话题有独立的时间线和成员会话，可以随时切回任意话题继续对话。替代现在「新对话 = 同一条时间线插分隔线」的做法。

## 关键决定

**话题 = 挂在根群下的隐藏子群记录。** 现有群聊运行态（`GroupChatService` 轮次 / 锁 / cursor、`BotSessionHost` 队列与会话绑定、委派、时间线存储、`BotEvent`、renderer `timelines`）全部按 `chatId` 建键，约 600 处引用。给它们逐个加 `threadId` 改动面过大；让每个话题本身就是一条 `BotChat`（`kind: 'group'`，带 `parentId`），这些链路不用改，只需把「群级共享资源」统一映射到根群。

- 根群自身就是第一个话题（老数据零迁移：原 `timeline.jsonl`、`sessions`、`epochSeq` 原样保留）。
- 子话题存为 `bot-chats/<threadId>/{chat.json, timeline.jsonl}`，`chat.json` 带 `parentId`，复制根群的成员 / 群主 / 分派 / 工作区。
- 切换只换视图；旧话题在后台照常运行（同一成员跨话题由宿主按成员排队，不会并发两轮）。
- 例行任务投进根群的 `activeThreadId`。

## 数据

```ts
interface BotChat {
  // 新增，均可选
  parentId?: BotChatId;        // 子话题：所属根群
  threadTitle?: string;        // 话题标题（根群自身也可有）
  activeThreadId?: BotChatId;  // 仅根群：当前话题，缺省 = 根群自身
}
```

- 不升 `schemaVersion`：新字段可选，旧版本读到子话题会当成普通群（可接受，降级不丢数据）。
- 子话题的 `members / bossBotId / routing / workspace` 是根群的副本，由 Main 在根群更新时级联同步，不允许单独修改。
- `parentId` 只能指向存在的根群（根群不能再有 `parentId`）；加载时父群缺失的子话题视为孤儿，忽略并在下次清理。

## 根群映射（`rootOf(chat) = chat.parentId ?? chat.id`）

| 资源 | 归属 | 说明 |
| --- | --- | --- |
| 时间线、成员会话、cursor、epochSeq、路由运行态、委派 | 话题 | 不改 |
| 群笔记 `notes.md`、群记忆 `chat:<id>`、任务看板 `tasks.jsonl`、浏览器会话 | 根群 | 读写与注入一律用 `rootOf` |
| 看板 / 例行提议的 system 时间线条目 | 话题 | 成员触发写其会话所在话题；人类 UI 操作写根群 `activeThreadId` |
| 例行任务 | 根群 | 触发时投进 `activeThreadId` |
| 成员 / 群主 / 分派 / 工作区 / 标题修改 | 根群 | 级联到所有子话题；移出成员、换工作区时各话题照现有规则结束会话 |
| 置顶 / 搁置 / 归档 / 未读 / 侧栏预览 | 根群 | 侧栏、手机目录过滤子话题；子话题有新消息时唤醒根群并取最新预览 |
| 删除群 | 根群 | 先删全部子话题（停运行、清会话与目录），再删根群 |
| 克隆群 | 根群 | 只克隆根群配置，不带话题 |
| ⌘K 搜索、产物卡片 | 话题 | 结果带话题 id，跳转时切到该话题 |

## IPC

- `BOT_THREAD_CREATE {chatId}`：在根群下建子话题并设为当前，返回新话题。替代群聊的「新对话」（私聊不变）。
- `BOT_THREAD_SELECT {chatId, threadId}`：设置 `activeThreadId`。
- `BOT_THREAD_RENAME {threadId, title}` / `BOT_THREAD_DELETE {threadId}`：删除根群自身话题不允许；删除当前话题后回到根群话题。
- 话题列表随 `BOT_CATALOG` 下发（子话题从聊天列表剥离，挂到根群下）。
- 发送、时间线读取、重试、停止等现有通道直接传话题 id；Main 校验它是群或群下的话题。

入参一律按 `unknown` 收窄；renderer 只传 id。

## 界面

- 群头部话题切换器：标题、最后活动时间、运行中标记、未读；重命名、删除。
- 「新对话」按钮改为「新话题」：建好直接切过去。
- 话题标题缺省取第一条用户消息截断，可改名。
- 群信息面板（成员、笔记、看板、例行）始终作用于根群。

## 不做

- 不把老群里「新对话」切出的旧段拆成话题。
- 话题之间不做引用或合并。
- 手机端只显示根群当前话题，不能切换；pair 协议不变。

## 实施

1. 数据与存储：`parentId / threadTitle / activeThreadId` 解析、`rootOf`、建 / 删话题、级联同步、列表过滤（TDD）。
2. Main 群级资源映射：笔记、记忆、看板、例行、浏览器、删除 / 克隆 / 搁置。
3. IPC 与事件。
4. Renderer 切换器、store、搜索跳转。
5. 真机：两家模型，两个话题来回切换续聊，确认上下文不串、后台话题照常运行。
