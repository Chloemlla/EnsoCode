import type {
  SpeechDownloadProgressDto,
  SpeechModelId,
  SpeechStatusDto,
} from '@shared/types/speech';
import { useCallback, useEffect, useState } from 'react';

/** 语音模型状态：挂载时查一次，下载结束（任一窗口发起）再查 */
export function useSpeechStatus(active = true) {
  const [status, setStatus] = useState<SpeechStatusDto | null>(null);
  /** 可同时下载多个模型，进度按模型分开 */
  const [progress, setProgress] = useState<
    Partial<Record<SpeechModelId, SpeechDownloadProgressDto>>
  >({});
  const [error, setError] = useState<{ modelId: SpeechModelId; message: string } | null>(null);
  const refresh = useCallback(() => {
    void window.electronAPI.speech
      .status()
      .then(setStatus)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!active) return;
    refresh();
    return window.electronAPI.speech.onProgress((next) => {
      if (next.done) {
        setProgress(({ [next.modelId]: _, ...rest }) => rest);
        setError(next.error ? { modelId: next.modelId, message: next.error } : null);
        refresh();
      } else {
        setProgress((current) => ({ ...current, [next.modelId]: next }));
        setError((current) => (current?.modelId === next.modelId ? null : current));
      }
    });
  }, [active, refresh]);
  return { status, progress, error, refresh };
}
