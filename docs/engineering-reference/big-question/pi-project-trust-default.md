# pi 默认信任项目：打开仓库即执行其扩展、自动安装其包

## 症状

没有任何报错。在 Enso 里打开一个带 `.pi/extensions/*.ts` 或 `.pi/settings.json` 里 `packages` 的仓库，第一次发消息时这些代码就以用户权限在 agent worker 里运行；项目包缺失时 pi 还会自动执行 `npm install` / `git clone`（项目 `npmCommand` 也会被采用）。

## 根因

- `DefaultResourceLoader` 没传 `settingsManager` 时自建 `SettingsManager.create(cwd, agentDir)`，`projectTrusted` 缺省为 `true`；只有 CLI 交互式传了 `resolveProjectTrust` 才会询问。
- `noExtensions: true` 只丢弃扩展路径，`packageManager.resolve()` 仍会解析并自动安装项目包，所以类型化子代理和锁定的 Enso 会话同样受影响。
- 直接设 `projectTrusted: false` 又太宽：会连带屏蔽 `.pi/skills`、祖先目录的 `.agents/skills`、`.pi/prompts`、`SYSTEM.md` 等纯内容资源。

## 修法

`src/agent/projectCode.ts`：

- `listProjectCodeSources(cwd)` 列出会被当代码加载的来源（`.pi/extensions/*`、`package:*`、`extension:*`、`setting:npmCommand|shellPath|shellCommandPrefix`），标签是相对路径，worktree 与主树一致。
- `createProjectSettingsManager(cwd, agentDir, trusted)`：来源全部在 `trusted` 里才按 pi 默认加载；否则用只读存储把项目 settings 去掉包与命令类键，并注入 `extensions: ['!**']` 排除 `.pi/extensions` 自动发现。内容资源不受影响。
- 所有 `DefaultResourceLoader`（父会话、子代理、锁定会话）都传这个 `settingsManager`。信任列表存在 `Project.trustedProjectCode`，Main 在 spawn 时下发；出现新来源时整个项目重新拦下。

## 回归防线

`src/agent/projectCode.test.ts` 用真实 `DefaultResourceLoader` 验证：未信任时扩展模块不执行、`npmCommand` 不运行、项目技能照常加载；信任后加载；信任后新增来源重新拦截。

## 相关代码

- `src/agent/projectCode.ts`、`src/agent/supervisor.ts`（`createSessionResourceLoader` / `createEnsoResourceLoader`）
- `src/main/ipc/projects.ts`（`PROJECTS_CODE_SOURCES`）、`src/renderer/components/chat/ProjectCodeTrustBar.tsx`
