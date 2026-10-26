import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Api, AssistantMessageEventStream, Context, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { type MaskReport, MaskReportBuilder } from '@shared/privacyMask/report';
import type { PrivacyMaskSettings } from '@shared/privacyMask/settings';
import { PrivacyVault } from '@shared/privacyMask/vault';
import { maskDeep, wrapStreamFn } from './index';

export type PrivacyReportSink = (report: MaskReport, model: Model<Api>) => void;

const sinks = new AsyncLocalStorage<PrivacyReportSink>();
/** 会话 streamFunction 包一层 scope，runtime 出口据此把报告归到对应会话 */
export const runWithPrivacySink = <T>(sink: PrivacyReportSink, work: () => T): T =>
  sinks.run(sink, work);

const KEY_FILE = 'privacy-mask.key';
const inactive = new PrivacyVault({ digest: () => new Uint8Array(32) });
let vault: PrivacyVault | undefined;

function loadKey(file: string): Buffer {
  try {
    const key = fs.readFileSync(file);
    if (key.length === 32) return key;
  } catch {
    // 缺失或损坏时重建
  }
  const key = randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, key, { mode: 0o600 });
  } catch {
    // 写不进去也能用：本进程内占位符仍稳定
  }
  return key;
}

/** 从未开启过就不建 key 文件；开过之后保留值表，关掉只停用规则 */
export function configurePrivacyMasking(agentDir: string, settings: PrivacyMaskSettings): void {
  if (!vault) {
    if (!settings.enabled) return;
    const key = loadKey(path.join(agentDir, KEY_FILE));
    vault = new PrivacyVault({
      digest: (data) => new Uint8Array(createHmac('sha256', key).update(data).digest()),
    });
  }
  vault.configure(settings);
}

export const currentPrivacyVault = (): PrivacyVault => vault ?? inactive;

type StreamMethod = (
  model: Model<Api>,
  context: Context,
  options?: unknown
) => AssistantMessageEventStream;
type ClassifyMethod = (model: Model<Api>, context: unknown, options?: unknown) => Promise<unknown>;

/**
 * 包共享 runtime 实例的出口：会话、compaction、cache warmer、辅助补全都走这里。
 * complete / completeSimple / 虚拟模型路由内部都回调 this.stream(Simple)，实例属性覆盖即可全覆盖。
 */
export function installPrivacyMasking(runtime: ModelRuntime, fallback: PrivacyReportSink): void {
  const target = runtime as unknown as {
    stream?: StreamMethod;
    streamSimple?: StreamMethod;
    classify?: ClassifyMethod;
  };
  for (const name of ['stream', 'streamSimple'] as const) {
    const method = target[name];
    if (typeof method !== 'function') continue;
    const original: StreamMethod = method.bind(runtime);
    target[name] = (model, context, options) => {
      // cache warmer（maxTokens:1）照样脱敏以命中缓存，但不重复记账
      const warm = (options as { maxTokens?: number } | undefined)?.maxTokens === 1;
      const sink: PrivacyReportSink = warm ? () => {} : (sinks.getStore() ?? fallback);
      return wrapStreamFn(currentPrivacyVault, original, sink)(model, context, options);
    };
  }
  if (typeof target.classify !== 'function') return;
  const classify: ClassifyMethod = target.classify.bind(runtime);
  target.classify = (model, context, options) => {
    const v = currentPrivacyVault();
    if (!v.active || !context || typeof context !== 'object')
      return classify(model, context, options);
    const sink = sinks.getStore() ?? fallback;
    const report = new MaskReportBuilder();
    const ctx = context as { state?: unknown };
    const masked = { ...ctx, state: maskDeep(v, ctx.state, report, 'user') };
    // 分类只取概率，不回传正文：拦截在这里等同脱敏
    report.blocked = false;
    if (!report.empty) sink(report.build(), model);
    return classify(model, masked, options);
  };
}
