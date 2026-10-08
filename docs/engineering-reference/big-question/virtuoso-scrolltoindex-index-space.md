# Virtuoso scrollToIndex 与 rangeChanged 是两个下标空间：叠 firstItemIndex 必被钳到末行

## 症状

对话左侧导航条（NavRail）和会话内搜索跳转：**点任何一条都跳到最新那条消息**，
永远落不到目标轮次。症状稳定复现、与数据无关，看起来像"目标查找逻辑坏了"。

## 根因

react-virtuoso 的两个 API 用不同下标坐标系（4.18.12 dist 源码实证）：

- `scrollToIndex({ index })` 吃 **data 相对下标**（0 基）：入参归一化只做
  `Math.max(0, Math.min(totalCount - 1, index))`，全程不出现 firstItemIndex，
  越界**静默钳到首行/末行**，无报错。
- `rangeChanged` 上报的 startIndex/endIndex 是**叠过 firstItemIndex 的绝对下标**
  （listState 构建时 `index = originalIndex + firstItemIndex`）。

本仓库时间线的 `firstItemIndex` 原点恒为 `TIMELINE_ROW_INDEX_BASE = 1_000_000`
（`timelineRowOrigin.ts`，前置分页靠原点减法钉住已渲染行）。commit 409e67e9
修 rangeChanged 高亮时（绝对下标，减法正确）顺手把 scrollToIndex 也改成
`firstItemIndex + index`——百万级下标永远越界，**任何跳转都被钳到末行**，
即"永远跳到最新一条"。同一调用点服务 NavRail 点击与搜索跳转，一起坏掉。

教训：改库调用时下标/偏移语义要逐 API 核实，不能从一个 API 的坐标系类推另一个；
"钳位型"API 参数错了不报错，只会稳定地落在错误位置。

## 修法

scrollToIndex 传 data 相对下标，不叠原点（`MessageTimeline.tsx` `scrollToFoldedKey`）：

```ts
virtuosoRef.current?.scrollToIndex({ index: virtuosoScrollIndex(firstItemIndex, index), align: 'center' });
```

`virtuosoScrollIndex`（`timelineRowOrigin.ts`）是恒等函数，`_firstItemIndex` 形参
故意留在签名里作陷阱路标，doc 注释写明两个坐标系的差异。

## 回归防线

- `timelineRowOrigin.test.ts` 的 `virtuosoScrollIndex` 契约测试：原点再大也不参与
  计算。变异验证过——实现改回 `_firstItemIndex + dataIndex` 测试必红。
- 局限：测试钉的是本地契约；升级 Virtuoso 大版本时需重新核对 scrollToIndex 语义。

## 相关代码

- `src/renderer/components/chat/MessageTimeline.tsx`（`scrollToFoldedKey` / `jumpTo` / `rangeChanged`）
- `src/renderer/components/chat/timelineRowOrigin.ts`（原点与 `virtuosoScrollIndex`）
- `src/renderer/components/chat/timelineRowOrigin.test.ts`（契约测试）
