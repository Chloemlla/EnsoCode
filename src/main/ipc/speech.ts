import { IPC_CHANNELS } from '@shared/types';
import {
  isSpeechModelId,
  SPEECH_SAMPLE_RATE,
  SPEECH_SESSION_ID_MAX,
  type SpeechPartialDto,
  type SpeechStatusDto,
  type SpeechTranscribeResult,
  type VoiceSession,
} from '@shared/types/speech';
import { ipcMain, systemPreferences, type WebContents } from 'electron';
import {
  cancelSpeechDownload,
  deleteSpeechModel,
  getSpeechStatus,
  onSpeechAvailabilityChange,
  openSpeechSession,
  prewarmSpeech,
  setSpeechProgressSink,
  startSpeechDownload,
} from '../services/speech/service';
import { sendToAllWindows } from '../windows/createAppWindow';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

const UNSUPPORTED: SpeechStatusDto = {
  state: 'unsupported',
  selected: 'x-asr-streaming',
  models: [],
};
/** 单次推送上限：采集端约 100ms 一块，留足余量 */
const MAX_PUSH_SAMPLES = SPEECH_SAMPLE_RATE * 10;
/** 同一窗口最多挂两个会话；页面重载留下的孤儿会话按先进先出回收 */
const MAX_SESSIONS_PER_SENDER = 2;

const sessions = new Map<number, Map<string, VoiceSession>>();

function isTrustedWindow(webContentsId: number): boolean {
  return isMainWebContents(webContentsId) || isSettingsWebContents(webContentsId);
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SPEECH_SESSION_ID_MAX;
}

function sessionsOf(sender: WebContents): Map<string, VoiceSession> {
  let owned = sessions.get(sender.id);
  if (!owned) {
    const id = sender.id;
    owned = new Map();
    sessions.set(id, owned);
    sender.once('destroyed', () => {
      for (const session of sessions.get(id)?.values() ?? []) session.cancel();
      sessions.delete(id);
    });
  }
  return owned;
}

export function registerSpeechHandlers(): void {
  // 设置窗下载，主窗口据 done 事件重查状态决定是否显示麦克风
  // （主窗口 UI 在 WebContentsView 里，win.webContents.send 送不到）
  setSpeechProgressSink((progress) => sendToAllWindows(IPC_CHANNELS.SPEECH_PROGRESS, progress));
  // 设置变化（如填入云端 Key）改变可用性时，各窗口重查状态
  onSpeechAvailabilityChange(() => sendToAllWindows(IPC_CHANNELS.SPEECH_STATUS_CHANGED));

  ipcMain.handle(IPC_CHANNELS.SPEECH_STATUS, (event) =>
    isTrustedWindow(event.sender.id) ? getSpeechStatus() : UNSUPPORTED
  );

  ipcMain.handle(IPC_CHANNELS.SPEECH_DOWNLOAD, (event, modelId: unknown) => {
    if (!isTrustedWindow(event.sender.id) || !isSpeechModelId(modelId)) return false;
    void startSpeechDownload(modelId);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SPEECH_CANCEL, (event, modelId: unknown) =>
    isTrustedWindow(event.sender.id) && isSpeechModelId(modelId)
      ? cancelSpeechDownload(modelId)
      : false
  );

  ipcMain.handle(IPC_CHANNELS.SPEECH_DELETE, (event, modelId: unknown) =>
    isTrustedWindow(event.sender.id) && isSpeechModelId(modelId)
      ? deleteSpeechModel(modelId)
      : false
  );

  // 首块到达时开会话；中间结果只回发给发起窗口
  ipcMain.on(IPC_CHANNELS.SPEECH_SESSION_PUSH, (event, sessionId: unknown, audio: unknown) => {
    const sender = event.sender;
    if (!isMainWebContents(sender.id) || !isSessionId(sessionId)) return;
    if (!(audio instanceof Float32Array) || audio.length > MAX_PUSH_SAMPLES) return;
    const owned = sessionsOf(sender);
    let session = owned.get(sessionId);
    if (!session) {
      if (owned.size >= MAX_SESSIONS_PER_SENDER) {
        const [oldestId, oldest] = owned.entries().next().value as [string, VoiceSession];
        oldest.cancel();
        owned.delete(oldestId);
      }
      session = openSpeechSession((text, correcting) => {
        if (sender.isDestroyed()) return;
        const partial: SpeechPartialDto = { sessionId, text, correcting };
        sender.send(IPC_CHANNELS.SPEECH_PARTIAL, partial);
      });
      owned.set(sessionId, session);
    }
    session.push(audio);
  });

  ipcMain.handle(
    IPC_CHANNELS.SPEECH_SESSION_FINISH,
    (event, sessionId: unknown): Promise<SpeechTranscribeResult> | SpeechTranscribeResult => {
      if (!isMainWebContents(event.sender.id)) return { ok: false, error: 'disabled' };
      if (!isSessionId(sessionId)) return { ok: false, error: 'invalid-audio' };
      const owned = sessions.get(event.sender.id);
      const session = owned?.get(sessionId);
      // 一块都没推上来：录音为空
      if (!session) return { ok: false, error: 'invalid-audio' };
      owned?.delete(sessionId);
      return session.finish();
    }
  );

  ipcMain.on(IPC_CHANNELS.SPEECH_SESSION_CANCEL, (event, sessionId: unknown) => {
    if (!isSessionId(sessionId)) return;
    const owned = sessions.get(event.sender.id);
    owned?.get(sessionId)?.cancel();
    owned?.delete(sessionId);
  });

  // macOS 必须由主进程发起授权；拒绝过则只能去系统设置里打开
  ipcMain.handle(IPC_CHANNELS.SPEECH_MIC_ACCESS, async (event) => {
    if (!isMainWebContents(event.sender.id)) return false;
    // 开录第一步就是问授权：顺带让云端模型提前建连
    prewarmSpeech();
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });
}
