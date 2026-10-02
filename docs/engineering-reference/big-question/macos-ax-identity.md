# macOS AX 树可见，查询却漏掉控件

## 症状

显示器页面的 `getState()` 能看到亮度滑块，但 `find({ role: 'AXSlider' })` 返回空。
树中侧边栏出现两遍。通过 ref 操作滑块时，`actions()` 返回空，`setValue('0')`
不报错却没有可见变化。

## 根因

- 同一个 AX 元素经不同属性读取会得到不同的 koffi 指针对象；JS `Set` 不能识别
  它们是同一个原生元素。`AXWindows`/`AXChildren` 及 `AXChildren`/`AXContents`
  带来的重复节点耗尽 80 节点查询预算。实机中滑块在未去重遍历的第 105 个节点，
  按 `CFEqual` 去重后在第 46 个节点。
- 亮度滑块不提供可设置的 `AXValue`，只暴露 `AXIncrement` / `AXDecrement`。
  原生 node 查询未读取 action names，因此模型无法发现这条操作路径。

## 修法

原生引用按 `CFEqual` 去重，并保持每份 owned 引用的 retain/release 平衡。
`node()` 返回实际 action names；`setValue` 在写入前检查 `AXUIElementIsAttributeSettable`，
不可设置时明确拒绝并提示已有动作，不自动转成键盘或像素输入。
`attributes()` 至少保留描述中已有的 title/value/description。

## 回归防线

- `axCfArray.test.ts` 覆盖不同 JS 引用代表同一原生元素。
- `axNative.test.ts` 覆盖属性投影和不可写 AXValue 的拒绝提示。
- 修复后的实机原生只读查询能命中亮度滑块，返回两个增减动作；snapshot 的重复
  侧边栏消失。动作执行仍须通过更新后应用的工具链路单独验证。

## 相关代码

- `src/main/services/computer/axCfArray.ts`
- `src/main/services/computer/axNative.ts`
- `src/main/services/computer/axWalkBudget.ts`
