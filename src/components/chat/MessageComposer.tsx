import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Square, SquarePen } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { cn } from '../../utils/cn';

interface MessageComposerProps {
  onSend: (content: string) => void;
  hasActiveConversation: boolean;
  onNewChat: () => void;
  isStreaming?: boolean;
  isSubmitting?: boolean;
  onStop?: () => void;
  isAuthenticated?: boolean;
}

export function MessageComposer({
  onSend,
  hasActiveConversation,
  onNewChat,
  isStreaming = false,
  isSubmitting = false,
  onStop,
  isAuthenticated = false,
}: MessageComposerProps) {
  const { settings, setVoiceModalOpen, setAuthPreviewOpen, showToast } =
    useWorkspace();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isStreaming || isSubmitting) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-4 pt-2">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[#D1D5DB] dark:border-white/15 bg-white dark:bg-[#12192E] focus-within:border-[#0B1020] dark:focus-within:border-[#B8F34A]/70 transition-colors shadow-sm"
      >
        <div className="px-4 pt-3.5 pb-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && settings.enterToSend) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              isStreaming
                ? 'Klyvo is responding... Click Stop to cancel'
                : 'Message Klyvo...'
            }
            aria-label="Message Klyvo"
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#0B1020] dark:text-white placeholder:text-[#9CA3AF] dark:placeholder:text-[#64748B] focus:outline-none max-h-[200px]"
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {hasActiveConversation && (
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-medium text-[#4B5563] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] hover:text-[#0B1020] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                <SquarePen className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Chat</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (!isAuthenticated) {
                  setAuthPreviewOpen(true);
                  showToast('Sign in to start a real-time Voice conversation');
                  return;
                }
                setVoiceModalOpen(true);
              }}
              aria-label="Open Voice Mode"
              title="Voice Mode"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 text-xs font-medium text-[#0B1020] dark:text-[#E2E8F0] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              <Mic className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#B8F34A]" />
              <span className="hidden sm:inline">Voice</span>
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generation"
                title="Stop generation"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#0B1020] dark:bg-white text-white dark:text-[#0B1020] hover:opacity-90 text-xs font-semibold transition-opacity shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!value.trim() || isSubmitting}
                aria-label="Send message"
                className={cn(
                  'inline-flex items-center justify-center h-9 w-9 rounded-xl transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1020] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]',
                  value.trim() && !isSubmitting
                    ? 'bg-[#B8F34A] text-[#0B1020] hover:bg-[#a8e636]'
                    : 'bg-[#E5E7EB] dark:bg-[#1B2337] text-[#9CA3AF] dark:text-[#64748B] cursor-not-allowed',
                )}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.25]" />
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="mt-2 text-center text-[11px] text-[#6B7280] dark:text-[#64748B]">
        {isAuthenticated
          ? 'Klyvo uses Gemini AI · Verify important facts in critical responses'
          : 'Guest workspace (local only) · Sign in for live Gemini AI responses'}
      </p>
    </div>
  );
}
