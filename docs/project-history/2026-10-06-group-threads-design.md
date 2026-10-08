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
- `parentId` 只能指向存在的根群（根群不能再有 `parentId`）；加载时忽略孤儿，但保留磁盘文件。

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
- `BOT_THREAD_UPDATE {chatId, title}` / `BOT_THREAD_DELETE {chatId}`：删除根群自身话题不允许；删除当前话题后回到根群话题。
- 话题列表随 `BOT_CHATS_LIST` 下发，renderer 将子话题折叠到根群行。
- 发送、时间线读取、重试、停止等现有通道直接传话题 id；Main 校验它是群或群下的话题。

入参一律按 `unknown` 收窄；renderer 只传 id。

## 界面

- 群头部话题切换器：标题、最后活动时间、运行中标记、未读；重命名、删除。
- 下拉框最多 10 个话题：主话题与当前话题必留，其次未读 / 进行中，再按最近活动补足；超出时底部给「全部话题（N）」弹窗，弹窗内按最近活动排序，可搜索标题 / 预览，按全部 / 未读 / 进行中筛选，逐行改名或删除。
- 「新对话」按钮改为「新话题」：建好直接切过去。
- 话题标题缺省取第一条用户消息截断，可改名。
- 群信息面板（成员、笔记、看板、例行）始终作用于根群。
- 面板里的回复队列、成员在场状态与委派列表跟随当前话题；浏览器标签仍共享根群。
- 切换和新建有选择序号保护，在途旧目录快照不能抢回视图或丢掉新建话题。

## 不做

- 不把老群里「新对话」切出的旧段拆成话题。
- 话题之间不做引用或合并。
- 手机端话题改名 / 删除。（列出、切换、新建已由 #34 补上：`bot-thread-create / bot-thread-select` 复用桌面 handler，`bot-chats.threads` 下发子话题，`bot-catalog.threads` 声明能力；切换即改根群 `activeThreadId`，桌面与手机同步；只读设备由 Main 拦截。）

## 实施

1. 数据与存储：`parentId / threadTitle / activeThreadId` 解析、`rootOf`、建 / 删话题、级联同步、列表过滤（TDD）。
2. Main 群级资源映射：笔记、记忆、看板、例行、浏览器、删除 / 克隆 / 搁置。
3. IPC 与事件。
4. Renderer 切换器、store、搜索跳转。
5. 真机：两家模型，两个话题来回切换续聊，确认上下文不串、后台话题照常运行。

## 验证记录

真机（隔离 userData，Max claude-sonnet-4-6 + hei qwen3.8-max）：主话题约定暗号「苹果」，新话题约定「香蕉」；切回主话题问 Qwen 答「苹果」，切到新话题问 Clau 答「香蕉」。新话题里让 Qwen 写诗后立即切回主话题，回复在后台照常完成，切换器与侧栏显示未读与最新预览；重载后仍停在上次选中的话题。

踩坑：`MenuGroupLabel` 必须包在 `MenuGroup` 里，否则打开菜单时 base-ui 抛错导致整窗白屏（单测不渲染菜单弹层，只有真机能发现）。

边界回归覆盖：搜索与系统通知定位主话题、旧目录刷新晚到 / 新建期间再切换、后台话题未读聚合、根群 cursor 更新不重写其他话题、压缩后群状态注入共享看板，以及话题成员占用的根群浏览器标签。

补充 Electron 回归（隔离 userData、fake provider）：连续切换 20 次保持最后选择；子话题看板展示共享任务；菜单改名持久化，删除当前话题后回到主话题，根群看板任务保留。

## 私聊续聊旧对话

私聊不建子记录：每段对话本来就是成员的一个独立会话，切回去即重新打开原会话续写。

- `authority.reopenBotConversation`：结束的 bot 会话回到 `ready`（有会话文件）或 `draft`；所属项目不再 active 时拒绝。
- `host.switchSession / canSwitch`：目标须属于本聊天该成员，且会话项目与成员当前工作区一致，否则 `workspace-changed`，只能只读查看。成功后原当前会话结束只读，目标写回 `chat.sessions`，下次投递按 `resumeFile` 恢复。
- `BOT_CHAT_SWITCH_SESSION {chatId, conversationId}`：仅私聊；先做无副作用校验，再停当前回合、提炼当前会话记忆、切换；与「新对话」共用 `resettingChats` 防并发。记忆水位本来就按会话持久化，切回不会重复提炼。
- `BOT_CHAT_SESSIONS` 每条带 `resumable`、`title`（只读会话文件头，取首条用户消息，去掉笔记块、补充说明、引用与技能块，例行取标题）与 `activityAt`（文件修改时间）。
- 界面：私聊头部在「新对话」左侧加对话切换器（至少两段时出现），下拉与「全部对话」弹窗复用话题的取前 10 与搜索；回复中切换先确认会停止当前回复；工作区换过的旧对话标「只读」，点开为只读历史。
- 不做：对话改名 / 删除、后台并行运行多段对话、手机端切换。

真机（隔离 userData，Max claude-sonnet-4-6 + hei qwen3.8-max）：两个成员各在第一段约定「苹果」、新对话约定「香蕉」；从切换器切回第一段，问暗号 Clau 与 Qwen 都答「苹果」且续用原会话 id。Qwen 回复长文途中切换弹出确认，确认后停止并切回；再切回第二段问暗号答「香蕉」。
