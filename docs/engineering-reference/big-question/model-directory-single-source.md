---
title: 统一模型目录：清单是派生数据，settings 只存稀疏覆盖
tags: [model, settings, oauth, architecture, vitest-mock]
---

# 统一模型目录：清单是派生数据，settings 只存稀疏覆盖

## 事故根因

模型清单曾同时存在四份各自腐化的子集：登录时冻结进 `settings.json` 的全量拷贝
（`ProviderSetupWizard` 一次性写入，**没有任何增量同步机制**）、worker 运行时注册表、
provider 模块级发现缓存（main/worker 各一份）、settings store。典型事故：静态表新增的
`gemini-3.8-flash` 永远进不了老账号的冻结清单，subagent 选模器自然没有它（issue #124 第 4 点）。

## 架构决策（feat/unified-model-catalog）

- **清单 = 派生数据**：Main 侧 `src/main/services/modelDirectory.ts` 是唯一权威源
  （runtime catalog + 动态发现缓存 + xAI 旁路探测 + settings 自定义 provider 合成），
  Renderer 经 `modelDirectory:get/changed` 订阅，worker 经 `set-model-directory` 命令拿快照。
- **settings.json 的 OAuth 条目 models 只存稀疏覆盖表**：`enabled:false` / 用户别名 /
  能力覆盖。物化统一走 `materializeProviders`（`src/shared/modelDirectory.ts`），
  目录缺失时原样兜底。自定义 provider 的 models 仍是用户数据，不收缩。
- **写回陷阱**：物化会往每行注入目录 label，保存时必须用
  `extractModelOverrides(models, baseline)` 带基线 diff，否则稀疏表被重新膨胀成稠密拷贝。
- **冷态守卫**：目录分区缺失或 0 模型时，`revalidateDefaultModel` 必须 defer 绝不写回
  （虚拟默认模型要解析全部成员引用逐个查）。否则升级首启会把 OAuth 默认模型误判
  `model-missing` 写没。

## 测试配套（重要）

`oauthProviders`（登录完成）、`settings`（写成功）会后台动态 import modelDirectory，
其静态链 `modelDirectory → ipc/settings → services/oauthProviders` 会在**不确定时机**
把 oauthProviders 拉回 vitest 模块注册表，踩掉后续测试用 `resetModules + doMock` 搭的
fake runtime（报 `unknown oauth provider`）。凡跑这条链的测试文件必须显式
`vi.mock('./modelDirectory', () => ({ refreshModelDirectory: async () => {}, ... }))`
（参照 `oauthProviders.test.ts`、`settings.test.ts`、`agentHost.test.ts`、
`capabilityGateway.test.ts` 的既有 mock 块）。
