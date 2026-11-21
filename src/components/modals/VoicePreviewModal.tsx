import {
  AlertCircle,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BRAND_CONFIG } from '../../config/brand';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  DEFAULT_VOICE_MODEL,
  KlyvoVoiceEngine,
  type VoiceErrorCode,
  type VoiceSessionState,
  type VoiceTranscriptEntry,
} from '../../services/voiceService';
import { cn } from '../../utils/cn';
import { KlyvoLogo } from '../brand/KlyvoLogo';
import { Modal } from '../ui/Modal';

interface VoicePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATE_LABELS: Record<VoiceSessionState, string> = {
  idle: 'Ready to connect',
  requesting_permission: 'Requesting microphone access',
  connecting: 'Connecting to Gemini Live',
  listening: 'Listening',
  speaking: 'Klyvo is speaking',
  reconnecting: 'Reconnecting session',
  error: 'Session interrupted',
};

export function VoicePreviewModal({ isOpen, onClose }: VoicePreviewModalProps) {
  const { user } = useAuth();
  const { setAuthPreviewOpen, showToast } = useWorkspace();

  const [sessionState, setSessionState] = useState<VoiceSessionState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VoiceErrorCode | null>(null);
  const [transcripts, setTranscripts] = useState<VoiceTranscriptEntry[]>([]);

  const engineRef = useRef<KlyvoVoiceEngine | null>(null);
  const isMountedRef = useRef(true);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const activeEngine = engineRef.current;
      engineRef.current = null;
      if (activeEngine) {
        void activeEngine.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (transcripts.length > 0) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [transcripts]);

  const createEngine = useCallback(() => {
    if (engineRef.current) {
      return engineRef.current;
    }

    const engine = new KlyvoVoiceEngine({
      onStateChange: (nextState) => {
        if (!isMountedRef.current) return;
        setSessionState(nextState);
        if (nextState === 'listening' || nextState === 'speaking') {
          setErrorMessage(null);
          setErrorCode(null);
        }
      },
      onMutedChange: (muted) => {
        if (!isMountedRef.current) return;
        setIsMuted(muted);
      },
      onMicLevel: (level) => {
        if (!isMountedRef.current) return;
        setMicLevel(level);
      },
      onTranscriptsChange: (entries) => {
        if (!isMountedRef.current) return;
        setTranscripts(entries);
      },
      onError: (err) => {
        if (!isMountedRef.current) return;
        setErrorMessage(err.message);
        setErrorCode(err.code);
      },
      onRequireAuth: () => {
        if (!isMountedRef.current) return;
        engineRef.current?.clearTranscripts();
        setTranscripts([]);
        showToast('Sign in to use real-time Voice Mode');
        onClose();
        setAuthPreviewOpen(true);
      },
    });

    engineRef.current = engine;
    return engine;
  }, [onClose, setAuthPreviewOpen, showToast]);

  const handleCloseModal = useCallback(() => {
    const activeEngine = engineRef.current;
    if (activeEngine) {
      void activeEngine.stop();
      activeEngine.clearTranscripts();
    }
    setTranscripts([]);
    setMicLevel(0);
    setIsMuted(false);
    setErrorMessage(null);
    setErrorCode(null);
    setSessionState('idle');
    onClose();
  }, [onClose]);

  // If modal closes externally (or via Escape/backdrop), stop session and clear transient transcripts
  useEffect(() => {
    if (!isOpen) {
      if (engineRef.current) {
        void engineRef.current.stop();
        engineRef.current.clearTranscripts();
      }
      setTranscripts([]);
      setSessionState('idle');
      setMicLevel(0);
      setIsMuted(false);
      setErrorMessage(null);
      setErrorCode(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !user) {
      if (engineRef.current) {
        void engineRef.current.stop();
        engineRef.current.clearTranscripts();
      }
      setTranscripts([]);
      onClose();
      setAuthPreviewOpen(true);
    }
  }, [isOpen, user, onClose, setAuthPreviewOpen]);

  const handleStart = useCallback(async () => {
    if (!user) {
      onClose();
      setAuthPreviewOpen(true);
      return;
    }

    setErrorMessage(null);
    setErrorCode(null);
    const engine = createEngine();
    await engine.start();
  }, [createEngine, onClose, setAuthPreviewOpen, user]);

  const handleEnd = useCallback(async () => {
    const activeEngine = engineRef.current;
    if (!activeEngine) return;
    await activeEngine.stop();
  }, []);

  const handleToggleMute = useCallback(() => {
    const activeEngine = engineRef.current;
    if (!activeEngine) return;
    activeEngine.toggleMute();
  }, []);

  const isActive =
    sessionState === 'requesting_permission' ||
    sessionState === 'connecting' ||
    sessionState === 'listening' ||
    sessionState === 'speaking' ||
    sessionState === 'reconnecting';

  const isBusyConnecting =
    sessionState === 'requesting_permission' ||
    sessionState === 'connecting' ||
    sessionState === 'reconnecting';

  const canMute =
    sessionState === 'listening' ||
    sessionState === 'speaking' ||
    sessionState === 'reconnecting';

  const activeScale =
    sessionState === 'listening' && !isMuted
      ? 1 + Math.min(0.24, micLevel * 0.24)
      : sessionState === 'speaking'
        ? 1.08
        : 1;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseModal}
      title="Voice Conversation"
      description={`${BRAND_CONFIG.appName} real-time voice · ${DEFAULT_VOICE_MODEL}`}
      maxWidthClass="max-w-lg"
    >
      <div className="flex flex-col">
        {/* Header Status & Activity Indicator */}
        <div className="flex flex-col items-center text-center pb-5 border-b border-[#E5E7EB] dark:border-white/10">
          <div className="mb-3">
            <KlyvoLogo size="sm" />
          </div>

          <div
            className="relative flex items-center justify-center w-24 h-24 my-2"
            aria-hidden="true"
          >
            <div
              className={cn(
                'absolute inset-0 rounded-full border transition-transform duration-150',
                sessionState === 'speaking'
                  ? 'border-[#7C3AED]/45 bg-[#7C3AED]/10'
                  : sessionState === 'listening' && !isMuted
                    ? 'border-[#B8F34A]/60 bg-[#B8F34A]/10'
                    : sessionState === 'error'
                      ? 'border-red-500/35 bg-red-500/5'
                      : 'border-[#E5E7EB] dark:border-white/10 bg-[#F3F4F6] dark:bg-[#1B2337]/60',
              )}
              style={{ transform: `scale(${activeScale.toFixed(3)})` }}
            />
            <div
              className={cn(
                'relative z-10 w-14 h-14 rounded-full flex items-center justify-center border transition-colors',
                sessionState === 'speaking'
                  ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
                  : sessionState === 'listening' && !isMuted
                    ? 'bg-[#0B1020] border-[#B8F34A]/60 text-[#B8F34A]'
                    : sessionState === 'error'
                      ? 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-500/40 text-red-600 dark:text-red-300'
                      : 'bg-[#0B1020] border-white/10 text-[#94A3B8]',
              )}
            >
              {isBusyConnecting ? (
                <Loader2 className="w-6 h-6 animate-spin text-[#B8F34A]" />
              ) : sessionState === 'speaking' ? (
                <Volume2 className="w-6 h-6" />
              ) : isMuted ? (
                <MicOff className="w-6 h-6 text-amber-400" />
              ) : (
                <Mic className="w-6 h-6" />
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 text-sm font-medium text-[#0B1020] dark:text-white">
            <span>{STATE_LABELS[sessionState]}</span>
            {isMuted && isActive && (
              <>
                <span aria-hidden="true" className="text-[#9CA3AF]">
                  ·
                </span>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-300">
                  Muted
                </span>
              </>
            )}
          </div>
          <p className="mt-1 text-xs text-[#6B7280] dark:text-[#94A3B8]">
            {sessionState === 'idle'
              ? 'Speak naturally once connected. You can interrupt Klyvo at any time.'
              : sessionState === 'listening' && !isMuted
                ? 'Microphone active · 16 kHz PCM live stream'
                : sessionState === 'speaking'
                  ? 'Playing audio response · Speak to interrupt'
                  : sessionState === 'reconnecting'
                    ? 'Refreshing ephemeral session token...'
                    : sessionState === 'requesting_permission'
                      ? 'Confirm microphone access in your browser prompt.'
                      : 'Voice session'}
          </p>
        </div>

        {/* Error Alert */}
        {sessionState === 'error' && errorMessage && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30 p-3 text-xs leading-relaxed text-red-800 dark:text-red-200"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">{errorMessage}</p>
              {errorCode === 'PERMISSION_DENIED' && (
                <p className="mt-1 text-[11px] opacity-90">
                  Tip: Open your browser site permissions for this page, set Microphone to Allow,
                  then click Reconnect.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Live Transcript Feed */}
        <div
          aria-label="Live voice transcript"
          aria-live="polite"
          className="mt-4 h-56 overflow-y-auto rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/70 p-3.5 space-y-3"
        >
          {transcripts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <p className="text-xs font-medium text-[#4B5563] dark:text-[#94A3B8]">
                No transcript yet
              </p>
              <p className="mt-1 text-[11px] text-[#6B7280] dark:text-[#64748B] max-w-xs">
                Live user and assistant speech transcripts appear here during an active voice
                conversation and are not persisted after you close this window.
              </p>
            </div>
          ) : (
            transcripts.map((entry) => {
              const isUser = entry.speaker === 'user';
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex flex-col max-w-[88%]',
                    isUser ? 'ml-auto items-end' : 'mr-auto items-start',
                  )}
                >
                  <span className="mb-1 text-[11px] font-medium text-[#6B7280] dark:text-[#94A3B8]">
                    {isUser ? 'You' : BRAND_CONFIG.appName}
                  </span>
                  <div
                    className={cn(
                      'rounded-xl px-3 py-2 text-xs leading-relaxed border',
                      isUser
                        ? 'bg-[#0B1020] dark:bg-[#1B2337] text-white border-[#0B1020] dark:border-white/10'
                        : 'bg-white dark:bg-[#12192E] text-[#0B1020] dark:text-[#F8FAFC] border-[#E5E7EB] dark:border-white/10',
                    )}
                  >
                    <span>{entry.text}</span>
                    {!entry.isFinal && (
                      <span className="ml-1 inline-block opacity-60" aria-hidden="true">
                        …
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Action Controls */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {!isActive && sessionState !== 'error' && (
            <button
              type="button"
              onClick={() => void handleStart()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
            >
              <Phone className="w-4 h-4" />
              <span>Start conversation</span>
            </button>
          )}

          {sessionState === 'error' && (
            <>
              {errorCode === 'UNAUTHENTICATED' ? (
                <button
                  type="button"
                  onClick={() => {
                    handleCloseModal();
                    setAuthPreviewOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
                >
                  <span>Sign in to continue</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStart()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Reconnect</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCloseModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E5E7EB] dark:border-white/10 text-sm font-medium text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                <span>Close</span>
              </button>
            </>
          )}

          {isActive && (
            <>
              <button
                type="button"
                disabled={!canMute}
                onClick={handleToggleMute}
                aria-pressed={isMuted}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]',
                  !canMute && 'opacity-50 cursor-not-allowed',
                  isMuted
                    ? 'border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
                    : 'border-[#E5E7EB] dark:border-white/10 text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337]',
                )}
              >
                {isMuted ? (
                  <>
                    <MicOff className="w-4 h-4" />
                    <span>Unmute</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Mute</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleEnd()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End conversation</span>
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
