# macOS 浮窗层级不能代表输入焦点

## 症状

系统设置已在前台，computer 像素操作却报 `could not be brought to the front`。
重复 raise 或延长等待仍不能解决。

## 根因

`CGWindowListCopyWindowInfo` 是显示层级顺序，不是输入焦点顺序。
原实现将第一个 layer 0–8 的窗口标为 focused；实机中微信 layer 8 和 Thaw
layer 3 的浮窗排在系统设置 layer 0 前面，而 `NSWorkspace.frontmostApplication`
确认前台实际是系统设置。

## 修法

使用 `GetFrontProcess` / `GetProcessPID` 确定前台进程，再读取该进程的
`AXFocusedWindow`，通过 `_AXUIElementGetWindow` 得到确切窗口 ID。
进程和窗口 ID 必须同时匹配；读取失败时所有窗口均为非焦点，不回退到 z-order、
标题或同进程的其他窗口。不移除输入前的焦点校验，也不按应用名过滤浮窗。

## 回归防线

- `macWindowFocus.test.ts` 覆盖浮窗先出现、同进程多窗口、焦点未知、窗口消失、
  PID 不符和旧 focused 标记。
- 修改后的 native 源码在实机只读调用 `windows()`，确认浮窗为 false，系统设置为 true。
- 原生读取验证不等同于 Electron 端到端验证；更新应用后仍需复测工具链路。

## 相关代码

- `src/main/services/computer/macosNative.ts`
- `src/main/services/computer/macWindowFocus.ts`
- `src/main/services/computer/guest.ts`
