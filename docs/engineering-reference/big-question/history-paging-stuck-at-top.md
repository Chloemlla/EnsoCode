# 长会话上滑翻页停在半截 / 跳回底部

## 症状

冷会话（只持有尾窗）往上滚，加载一两页后再也翻不动：顶部固定是一条「上下文已压缩（压缩前 N tokens）」，
上面明明还有大量历史；或者每翻一页就被甩回底部。jsonl、`readParentHistoryTail` 返回都正常。

## 根因

三处叠加，症状在时间线，源头在压缩锚点：

1. 压完提示锚点 `compactionNoticeAt` 由 renderer 在压缩结束时取 `messages.length`。正文被冷缓存
   清空时记成 0；只持有尾窗时是局部长度，而行 key 是绝对下标。锚点早于窗起点，
   `insertCompactionNotice` 就把提示插在第 0 行，且每次前置新页后它仍是第 0 行。
2. `nextTimelineRowOrigin` 只用旧首行对齐 `firstItemIndex`：首行钉死 → 原点永远不动；
   新页把旧首行并进过程组（组 key = `group-<首个子行>`）→ 旧首行消失 → 重挂 Virtuoso，
   `initialTopMostItemIndex: LAST` 直接回到底部。
3. Virtuoso 的 `startReached` 对「首个渲染项的绝对下标」做 `distinctUntilChanged`。
   `firstItemIndex` 不动时同一个 Virtuoso 实例只会报一次，之后怎么滚都不再触发。

## 修法

- `insertCompactionNotice`：锚点不在最新摘要之后即视为失效，不插提示；store 记录锚点时加上
  `historyBaseIndex`，与行 key 同为绝对下标。
- `nextTimelineRowOrigin`：按第一条仍在的旧行对齐，旧行全不在才重挂。
- `MessageTimeline`：翻页游标（`olderCursor` = `historyBaseIndex`）变化即解锁；新页整段并进首行
  或只含孤立 toolResult 时 `firstItemIndex` 不变，落页后若首行仍在渲染范围就主动接着翻。

## 回归防线

- `timeline.test.ts`：锚点为 0 / 局部长度 / 等于摘要下标时不钉提示；尾窗绝对锚点落在摘要之后。
- `timelineRowOrigin.test.ts`：首行并组时不重挂、原点按前置行数移动；整段并进首行时原点不动。
- `index.test.ts`：只持有尾窗时压缩锚点取绝对下标。
- 真机：隔离实例 + 真实 7MB 会话，受信任滚轮从底滚到顶，16 页全部加载、无跳底、顶部显示「已到对话开头」。

## 相关代码

- `src/renderer/stores/sessions/timeline.ts`（`insertCompactionNotice`）
- `src/renderer/stores/sessions/index.ts`（`compaction` end 事件）
- `src/renderer/components/chat/timelineRowOrigin.ts`
- `src/renderer/components/chat/MessageTimeline.tsx`
