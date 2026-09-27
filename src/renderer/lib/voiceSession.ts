import type { StartVoiceSession } from '@shared/types/speech';

/** 桌面录音会话：音频经 IPC 推给 Main，中间结果按会话 id 过滤 */
export const startDesktopVoiceSession: StartVoiceSession = (onPartial) => {
  const api = window.electronAPI.speech;
  const id = crypto.randomUUID();
  const off = api.onPartial((partial) => {
    if (partial.sessionId === id) onPartial(partial.text, partial.correcting === true);
  });
  let done = false;
  return {
    push: (samples) => {
      if (!done) api.pushAudio(id, samples);
    },
    finish: () => {
      done = true;
      return api.finishSession(id).finally(off);
    },
    cancel: () => {
      if (done) return;
      done = true;
      off();
      api.cancelSession(id);
    },
  };
};
