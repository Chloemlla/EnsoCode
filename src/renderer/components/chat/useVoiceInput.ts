import {
  SPEECH_MAX_SECONDS,
  type SpeechErrorCode,
  type StartVoiceSession,
  type VoiceSession,
} from '@shared/types/speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import {
  createSpeechEndDetector,
  SilentRecordingError,
  startVoiceRecording,
  type VoiceCaptureOptions,
  type VoiceRecording,
} from '@/lib/voiceCapture';

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface VoiceStartOptions extends VoiceCaptureOptions {
  /** 开口后停顿即自动结束；按住说话由松手决定，不开 */
  autoStop?: boolean;
}

const MIC_DENIED = 'Microphone access denied. Allow it in system settings.';

const TRANSCRIBE_ERROR: Record<SpeechErrorCode, string> = {
  disabled: 'Voice input is turned off.',
  'not-ready': 'The speech model is not downloaded yet.',
  'invalid-audio': 'The recording was empty or too long.',
  failed: 'Voice input failed.',
};

export function micErrorKey(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return MIC_DENIED;
  return 'Voice input failed.';
}

/** 录音 + 识别会话的生命周期；点按 / 按住两种按钮各自决定何时 start、finish、cancel */
export function useVoiceInput({
  startSession,
  requestMicAccess,
  onText,
}: {
  startSession: StartVoiceSession;
  requestMicAccess?: () => Promise<boolean>;
  onText: (text: string) => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const finishRef = useRef<() => Promise<void>>(async () => {});
  /** 每次 start / cancel 自增：启动途中被取消，等到的录音要丢掉 */
  const attemptRef = useRef(0);

  useEffect(
    () => () => {
      attemptRef.current++;
      recordingRef.current?.cancel();
      sessionRef.current?.cancel();
    },
    []
  );

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const cancel = useCallback(() => {
    attemptRef.current++;
    recordingRef.current?.cancel();
    sessionRef.current?.cancel();
    recordingRef.current = null;
    sessionRef.current = null;
    setPartial('');
    setCorrecting(false);
    setPhase('idle');
  }, []);

  const finish = useCallback(async () => {
    const recording = recordingRef.current;
    const session = sessionRef.current;
    if (!recording || !session) return;
    recordingRef.current = null;
    setPhase('transcribing');
    try {
      await recording.stop();
      const result = await session.finish();
      if (!result.ok) setError(t(TRANSCRIBE_ERROR[result.error]));
      else if (!result.text) setError(t('No speech detected.'));
      else onText(result.text);
    } catch (cause) {
      session.cancel();
      setError(t(cause instanceof SilentRecordingError ? MIC_DENIED : 'Voice input failed.'));
    } finally {
      sessionRef.current = null;
      setPartial('');
      setCorrecting(false);
      setPhase('idle');
    }
  }, [onText, t]);
  finishRef.current = finish;

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'recording' && elapsed >= SPEECH_MAX_SECONDS) void finish();
  }, [elapsed, finish, phase]);

  const start = async ({ autoStop = false, ...options }: VoiceStartOptions = {}) => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('Voice input needs a secure (HTTPS) connection.'));
      return;
    }
    const attempt = ++attemptRef.current;
    setPartial('');
    setCorrecting(false);
    setElapsed(0);
    setPhase('starting');
    let session: VoiceSession | null = null;
    try {
      if (requestMicAccess && !(await requestMicAccess())) {
        throw new DOMException('microphone denied', 'NotAllowedError');
      }
      if (attempt !== attemptRef.current) return;
      const opened = startSession((text, isCorrecting) => {
        if (sessionRef.current !== opened) return;
        setPartial(text);
        setCorrecting(isCorrecting);
      });
      session = opened;
      sessionRef.current = opened;
      const speechEnded = autoStop ? createSpeechEndDetector() : null;
      const recording = await startVoiceRecording((samples) => {
        opened.push(samples);
        if (speechEnded?.(samples) && sessionRef.current === opened) void finishRef.current();
      }, options);
      if (attempt !== attemptRef.current) {
        recording.cancel();
        return;
      }
      recordingRef.current = recording;
      // 麦克风真出声才算开录：此前界面停在「准备中」，免得开口太早丢字
      await recording.live;
      if (attempt !== attemptRef.current) return;
      setPhase('recording');
    } catch (cause) {
      if (attempt !== attemptRef.current) return;
      session?.cancel();
      sessionRef.current = null;
      setPhase('idle');
      setError(t(micErrorKey(cause)));
    }
  };

  return { phase, elapsed, error, setError, partial, correcting, start, finish, cancel };
}
