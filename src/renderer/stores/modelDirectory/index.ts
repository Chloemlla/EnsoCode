import { type ModelDirectorySnapshot, parseModelDirectorySnapshot } from '@shared/modelDirectory';
import { create } from 'zustand';

// preload 的 electronAPI 类型尚未携带 modelDirectory；按契约结构化收窄
type ModelDirectoryApi = {
  get(): Promise<unknown>;
  onChanged(cb: (snapshot: unknown) => void): () => void;
};

function modelDirectoryApi(): ModelDirectoryApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window.electronAPI as unknown as { modelDirectory?: ModelDirectoryApi }).modelDirectory;
}

interface ModelDirectoryState {
  snapshot: ModelDirectorySnapshot | undefined;
}

/** Main 派生的模型目录；不得持久化进 settings.json。 */
export const useModelDirectoryStore = create<ModelDirectoryState>(() => ({
  snapshot: undefined,
}));

let bootstrapped = false;

function applySnapshot(raw: unknown): void {
  const next = parseModelDirectorySnapshot(raw);
  if (!next) return;
  const current = useModelDirectoryStore.getState().snapshot;
  if (current && next.revision <= current.revision) return;
  useModelDirectoryStore.setState({ snapshot: next });
}

/**
 * 每个 renderer root 挂一次：启动取快照，随后只接受更新的 revision。
 * preload 未就绪或旧版本没有出口时静默降级，snapshot 保持 undefined。
 * 多次调用只订阅一次（StrictMode 双调用安全）。
 */
export function bootstrapModelDirectory(): void {
  if (bootstrapped) return;
  const api = modelDirectoryApi();
  if (!api) return;
  bootstrapped = true;
  api.onChanged((raw) => applySnapshot(raw));
  void api
    .get()
    .then(applySnapshot)
    .catch(() => {});
}
