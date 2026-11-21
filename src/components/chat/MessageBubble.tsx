import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { ChatMessage } from '../../types';
import { formatTimeShort } from '../../utils/formatDate';
import { KlyvoMark } from '../brand/KlyvoLogo';
import { MarkdownContent } from './MarkdownContent';

interface MessageBubbleProps {
  message: ChatMessage;
  isAuthenticated?: boolean;
  onRetry?: () => void;
  onRetrySave?: () => void;
}

export function MessageBubble({
  message,
  isAuthenticated = false,
  onRetry,
  onRetrySave,
}: MessageBubbleProps) {
  const { copiedId, copy } = useCopyToClipboard();
  const isCopied = copiedId === message.id;

  if (message.role === 'user') {
    const isSending = message.status === 'sending';
    const isFailed = message.status === 'error';

    return (
      <div className="flex flex-col items-end">
        <div
          className={
            isFailed
              ? 'max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-[#0B1020] dark:bg-[#1B2337] text-white px-4 py-3 border border-red-400/70 dark:border-red-500/60'
              : 'max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-[#0B1020] dark:bg-[#1B2337] text-white px-4 py-3 border border-transparent dark:border-white/10'
          }
        >
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
          {isSending ? (
            <span className="inline-flex items-center gap-1 text-[#6B7280] dark:text-[#94A3B8]">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Saving...</span>
            </span>
          ) : isFailed ? (
            <span className="inline-flex items-center gap-2 text-red-600 dark:text-red-400">
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>Not saved</span>
              </span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1 rounded px-1 font-medium underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              )}
            </span>
          ) : (
            <span>{formatTimeShort(message.createdAt)}</span>
          )}
        </div>
        {isFailed && message.errorMessage && (
          <p className="mt-0.5 max-w-[85%] sm:max-w-[75%] text-right text-[11px] text-red-600 dark:text-red-400">
            {message.errorMessage}
          </p>
        )}
      </div>
    );
  }

  if (message.status === 'error') {
    return (
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 shrink-0">
          <KlyvoMark size="sm" />
        </div>
        <div className="flex-1 min-w-0 rounded-2xl border border-red-300 dark:border-red-500/30 bg-red-50/70 dark:bg-red-950/20 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-900 dark:text-red-200">
                Unable to generate response
              </p>
              <p className="mt-1 text-xs leading-relaxed text-red-800 dark:text-red-300">
                {message.errorMessage || 'Unable to generate response.'}
              </p>
              {onRetry && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#1B2337] border border-red-200 dark:border-white/10 text-xs font-medium text-[#0B1020] dark:text-white hover:bg-red-50 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isAuthenticated ? 'Retry response' : 'Dismiss error'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isPhaseNotice = message.status === 'phase-notice';
  const isStreaming = message.status === 'streaming';
  const isAborted = Boolean(message.wasAborted);
  const isSaving = message.saveStatus === 'saving';
  const isUnsaved = !isStreaming && !isAborted && message.saveStatus === 'unsaved';

  return (
    <div className="flex items-start gap-3.5 group">
      <div className="mt-0.5 shrink-0">
        <KlyvoMark size="sm" />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={
            isPhaseNotice
              ? 'rounded-2xl border border-[#7C3AED]/25 dark:border-[#7C3AED]/40 bg-white dark:bg-[#12192E] p-4'
              : 'rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] px-5 py-4'
          }
        >
          {isPhaseNotice && (
            <div className="flex items-center gap-2 mb-2 text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA]">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Guest Workspace Notice</span>
            </div>
          )}

          {isStreaming && !message.content.trim() ? (
            <div
              className="inline-flex items-center gap-2 text-sm text-[#4B5563] dark:text-[#94A3B8]"
              aria-live="polite"
            >
              <Loader2 className="w-4 h-4 animate-spin text-[#7C3AED] dark:text-[#B8F34A]" />
              <span>Generating response...</span>
            </div>
          ) : (
            <div>
              <MarkdownContent content={message.content} messageId={message.id} />
              {isStreaming && (
                <span
                  aria-label="Streaming response"
                  className="inline-block w-2 h-4 ml-1 align-middle rounded-xs bg-[#7C3AED] dark:bg-[#B8F34A] animate-pulse"
                />
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-4 px-1 flex-wrap">
          <div className="flex items-center gap-2 text-[11px] text-[#6B7280] dark:text-[#94A3B8] tabular-nums flex-wrap">
            <span>Klyvo</span>
            <span aria-hidden="true">·</span>
            {isStreaming ? (
              <span className="inline-flex items-center gap-1 text-[#7C3AED] dark:text-[#B8F34A]">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Streaming...</span>
              </span>
            ) : (
              <span>{formatTimeShort(message.createdAt)}</span>
            )}

            {isSaving && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Saving...</span>
                </span>
              </>
            )}

            {isAborted && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <span>Stopped (not saved)</span>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="inline-flex items-center gap-1 rounded px-1 font-medium underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                </span>
              </>
            )}

            {isUnsaved && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-2 text-red-600 dark:text-red-400">
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>Not saved to cloud</span>
                  </span>
                  {onRetrySave && (
                    <button
                      type="button"
                      onClick={onRetrySave}
                      className="inline-flex items-center gap-1 rounded px-1 font-medium underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry save</span>
                    </button>
                  )}
                </span>
              </>
            )}
          </div>

          {!isStreaming && message.content.trim().length > 0 && (
            <button
              type="button"
              onClick={() => copy(message.content, message.id)}
              aria-label="Copy response"
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[#6B7280] dark:text-[#94A3B8] hover:text-[#0B1020] dark:hover:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#16A34A] dark:text-[#B8F34A]" />
                  <span className="text-[#16A34A] dark:text-[#B8F34A]">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>

        {isUnsaved && message.persistenceError && (
          <p className="mt-0.5 px-1 text-[11px] text-red-600 dark:text-red-400">
            {message.persistenceError}
          </p>
        )}
      </div>
    </div>
  );
}
