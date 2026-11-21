import type { ChatMessage } from '../types';
import type { MessageRow } from '../types/database';

export type ConversationMessagesStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ConversationMessagesLoadState {
  status: ConversationMessagesStatus;
  error: string | null;
}

export type ConversationMessagesSnapshot = Record<
  string,
  ConversationMessagesLoadState
>;

export function mapMessageRowToChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    status: 'complete',
    saveStatus: 'saved',
  };
}

/**
 * Merges freshly loaded persisted messages with any in-flight, unsaved,
 * streaming, or errored local messages while preserving chronological order.
 */
export function mergeLoadedMessages(
  existingLocalMessages: ChatMessage[],
  fetchedMessages: ChatMessage[],
): ChatMessage[] {
  if (existingLocalMessages.length === 0) {
    return [...fetchedMessages].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  const byId = new Map<string, ChatMessage>();
  for (const msg of fetchedMessages) {
    byId.set(msg.id, msg);
  }

  for (const localMsg of existingLocalMessages) {
    if (!byId.has(localMsg.id)) {
      const shouldPreserveLocal =
        localMsg.status === 'sending' ||
        localMsg.status === 'streaming' ||
        localMsg.status === 'error' ||
        localMsg.saveStatus === 'unsaved' ||
        localMsg.saveStatus === 'saving' ||
        localMsg.wasAborted;

      if (shouldPreserveLocal) {
        byId.set(localMsg.id, localMsg);
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * Manages lazy per-conversation message loading, deduplication of concurrent
 * requests, safe caching, and account-isolation resets.
 */
export class ConversationMessageCache {
  private epoch = 0;
  private readonly states = new Map<string, ConversationMessagesLoadState>();
  private readonly inFlight = new Map<string, Promise<boolean>>();

  reset(): void {
    this.epoch += 1;
    this.states.clear();
    this.inFlight.clear();
  }

  getEpoch(): number {
    return this.epoch;
  }

  getState(conversationId: string): ConversationMessagesLoadState {
    return (
      this.states.get(conversationId) ?? {
        status: 'idle',
        error: null,
      }
    );
  }

  getSnapshot(): ConversationMessagesSnapshot {
    const snapshot: ConversationMessagesSnapshot = {};
    for (const [id, state] of this.states.entries()) {
      snapshot[id] = state;
    }
    return snapshot;
  }

  markConversationLoaded(conversationId: string): void {
    this.states.set(conversationId, { status: 'loaded', error: null });
  }

  deleteConversation(conversationId: string): void {
    this.states.delete(conversationId);
    this.inFlight.delete(conversationId);
  }

  async ensureLoaded(params: {
    userId: string;
    conversationId: string;
    force?: boolean;
    fetchMessagesByConversation: (
      userId: string,
      conversationId: string,
    ) => Promise<MessageRow[]>;
    isCurrentUser: (userId: string) => boolean;
    isDeleted: (conversationId: string) => boolean;
    onLoaded: (rows: MessageRow[], mapped: ChatMessage[]) => void;
    onStateChange?: (snapshot: ConversationMessagesSnapshot) => void;
  }): Promise<boolean> {
    const {
      userId,
      conversationId,
      force = false,
      fetchMessagesByConversation,
      isCurrentUser,
      isDeleted,
      onLoaded,
      onStateChange,
    } = params;

    if (!isCurrentUser(userId) || isDeleted(conversationId)) {
      return false;
    }

    const current = this.getState(conversationId);
    if (!force && current.status === 'loaded') {
      return true;
    }

    const existingPromise = this.inFlight.get(conversationId);
    if (existingPromise && !force) {
      return existingPromise;
    }

    const capturedEpoch = this.epoch;
    this.states.set(conversationId, { status: 'loading', error: null });
    onStateChange?.(this.getSnapshot());

    let loadPromise!: Promise<boolean>;
    loadPromise = (async (): Promise<boolean> => {
      try {
        const rows = await fetchMessagesByConversation(userId, conversationId);

        if (
          this.epoch !== capturedEpoch ||
          !isCurrentUser(userId) ||
          isDeleted(conversationId)
        ) {
          return false;
        }

        const mapped = rows.map(mapMessageRowToChatMessage);
        this.states.set(conversationId, { status: 'loaded', error: null });
        onLoaded(rows, mapped);
        onStateChange?.(this.getSnapshot());
        return true;
      } catch (err: unknown) {
        if (
          this.epoch !== capturedEpoch ||
          !isCurrentUser(userId) ||
          isDeleted(conversationId)
        ) {
          return false;
        }

        const message =
          err instanceof Error
            ? err.message
            : 'Unable to load conversation messages.';
        this.states.set(conversationId, {
          status: 'error',
          error: message,
        });
        onStateChange?.(this.getSnapshot());
        return false;
      } finally {
        if (this.inFlight.get(conversationId) === loadPromise) {
          this.inFlight.delete(conversationId);
        }
      }
    })();

    this.inFlight.set(conversationId, loadPromise);
    return loadPromise;
  }
}
