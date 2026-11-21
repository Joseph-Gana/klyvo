import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { KlyvoMark } from '../brand/KlyvoLogo';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import { WelcomeScreen } from './WelcomeScreen';

export function ChatWorkspace() {
  const {
    activeConversation,
    isWorkspaceLoading,
    isActiveConversationMessagesLoading,
    activeConversationMessagesError,
    retryLoadActiveConversationMessages,
    isAuthenticatedWorkspace,
    isStreamingActive,
    sendUserMessage,
    stopGeneration,
    startNewChat,
    retryNoticeMessage,
    retrySaveMessage,
  } = useWorkspace();

  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const lastMessage = activeConversation?.messages[activeConversation.messages.length - 1];
  const hasStreamingMessage = activeConversation?.messages.some(
    (msg) => msg.status === 'streaming',
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: hasStreamingMessage ? 'auto' : 'smooth' });
  }, [
    activeConversation?.messages.length,
    lastMessage?.content.length,
    hasStreamingMessage,
    isSendingMessage,
  ]);

  const handleSend = async (content: string) => {
    setIsSendingMessage(true);
    try {
      await sendUserMessage(content);
    } finally {
      setIsSendingMessage(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full">
      <div className="flex-1 overflow-y-auto">
        {!activeConversation ? (
          isWorkspaceLoading ? (
            <div className="min-h-full flex items-center justify-center px-4">
              <div className="inline-flex items-center gap-2.5 text-sm text-[#4B5563] dark:text-[#94A3B8]">
                <Loader2 className="w-4 h-4 animate-spin text-[#7C3AED] dark:text-[#B8F34A]" />
                <span>Loading workspace...</span>
              </div>
            </div>
          ) : (
            <div className="min-h-full flex flex-col justify-center">
              <WelcomeScreen
                onSelectPrompt={(prompt) => {
                  void handleSend(prompt);
                }}
              />
            </div>
          )
        ) : (
          <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-[#E5E7EB] dark:border-white/10">
              <div className="min-w-0">
                <h1 className="font-display text-base sm:text-lg font-semibold text-[#0B1020] dark:text-white truncate">
                  {activeConversation.title}
                </h1>
                <p className="text-xs text-[#6B7280] dark:text-[#94A3B8] tabular-nums">
                  {isActiveConversationMessagesLoading &&
                  activeConversation.messages.length === 0
                    ? 'Loading messages...'
                    : `${activeConversation.messages.length} messages`}
                </p>
              </div>
            </div>

            {activeConversationMessagesError && (
              <div
                role="alert"
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{activeConversationMessagesError}</span>
                </div>
                <button
                  type="button"
                  onClick={retryLoadActiveConversationMessages}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#1B2337] border border-amber-300 dark:border-amber-500/30 font-medium text-[#0B1020] dark:text-white hover:opacity-90 transition-opacity self-start sm:self-auto shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            {isActiveConversationMessagesLoading &&
            activeConversation.messages.length === 0 ? (
              <div className="py-12 flex items-center justify-center gap-2.5 text-sm text-[#4B5563] dark:text-[#94A3B8]">
                <Loader2 className="w-4 h-4 animate-spin text-[#7C3AED] dark:text-[#B8F34A]" />
                <span>Loading conversation messages...</span>
              </div>
            ) : (
              activeConversation.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isAuthenticated={isAuthenticatedWorkspace}
                  onRetry={
                    message.status === 'error' || message.wasAborted
                      ? () => retryNoticeMessage(activeConversation.id, message.id)
                      : undefined
                  }
                  onRetrySave={
                    message.role === 'assistant' &&
                    message.status === 'complete' &&
                    !message.wasAborted &&
                    message.saveStatus === 'unsaved'
                      ? () => retrySaveMessage(activeConversation.id, message.id)
                      : undefined
                  }
                />
              ))
            )}

            {isSendingMessage && !hasStreamingMessage && !isStreamingActive && (
              <div className="flex items-center gap-3.5" aria-live="polite">
                <KlyvoMark size="sm" />
                <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7C3AED] dark:text-[#B8F34A]" />
                  <span>Saving message...</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageComposer
        onSend={handleSend}
        hasActiveConversation={Boolean(activeConversation)}
        onNewChat={startNewChat}
        isStreaming={isStreamingActive}
        isSubmitting={isSendingMessage}
        onStop={stopGeneration}
        isAuthenticated={isAuthenticatedWorkspace}
      />
    </div>
  );
}
