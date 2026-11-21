import type { ChatMessage } from '../types';
import type { ConversationRow, DatabaseMessageRole, MessageRow } from '../types/database';

export interface ConversationCreateOptions {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MessageCreateOptions {
  id?: string;
  touchConversation?: boolean;
}

export interface ConversationUpdatesInput {
  title?: string;
  folder_id?: string | null;
  updated_at?: string;
}

export interface ConversationPersistenceAdapter {
  createConversation: (
    userId: string,
    title: string,
    folderId: string | null,
    options?: ConversationCreateOptions,
  ) => Promise<ConversationRow>;
  createMessage: (
    userId: string,
    conversationId: string,
    role: DatabaseMessageRole,
    content: string,
    createdAt?: string,
    options?: MessageCreateOptions,
  ) => Promise<MessageRow>;
  updateConversation: (
    userId: string,
    conversationId: string,
    updates: ConversationUpdatesInput,
  ) => Promise<ConversationRow>;
  moveConversation: (
    userId: string,
    conversationId: string,
    folderId: string | null,
  ) => Promise<ConversationRow>;
  deleteConversation: (userId: string, conversationId: string) => Promise<void>;
}

/**
 * Serializes per-conversation database mutations (create, insert message,
 * rename, move, delete) and prevents deleted conversations from being
 * materialized as orphans when a user deletes a conversation while its
 * initial creation or first message insert is pending or in-flight.
 */
export class ConversationSyncQueue {
  private readonly persistedConversationIds = new Set<string>();
  private readonly deletedConversationIds = new Set<string>();
  private readonly persistedMessageIds = new Set<string>();
  private readonly inFlightMessageIds = new Set<string>();
  private readonly queues = new Map<string, Promise<void>>();

  reset(): void {
    this.persistedConversationIds.clear();
    this.deletedConversationIds.clear();
    this.persistedMessageIds.clear();
    this.inFlightMessageIds.clear();
    this.queues.clear();
  }

  seedPersistedConversations(conversationIds: Iterable<string>): void {
    this.persistedConversationIds.clear();
    for (const id of conversationIds) {
      this.persistedConversationIds.add(id);
    }
  }

  seedPersistedMessages(messageIds: Iterable<string>): void {
    for (const id of messageIds) {
      this.persistedMessageIds.add(id);
    }
  }

  replacePersistedMessages(messageIds: Iterable<string>): void {
    this.persistedMessageIds.clear();
    for (const id of messageIds) {
      this.persistedMessageIds.add(id);
    }
  }

  isConversationPersisted(conversationId: string): boolean {
    return this.persistedConversationIds.has(conversationId);
  }

  isConversationDeleted(conversationId: string): boolean {
    return this.deletedConversationIds.has(conversationId);
  }

  isMessagePersisted(messageId: string): boolean {
    return this.persistedMessageIds.has(messageId);
  }

  isMessageInFlight(messageId: string): boolean {
    return this.inFlightMessageIds.has(messageId);
  }

  hasPendingOperations(conversationId: string): boolean {
    return this.queues.has(conversationId);
  }

  enqueue(conversationId: string, op: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(conversationId) ?? Promise.resolve();
    const next = prev.then(op, op);
    this.queues.set(conversationId, next);
    void next.finally(() => {
      if (this.queues.get(conversationId) === next) {
        this.queues.delete(conversationId);
      }
    });
    return next;
  }

  markDeletedLocally(conversationId: string): {
    hadPersistedOrQueued: boolean;
  } {
    this.deletedConversationIds.add(conversationId);
    const hadPersistedOrQueued =
      this.persistedConversationIds.has(conversationId) ||
      this.queues.has(conversationId);
    return { hadPersistedOrQueued };
  }

  restoreAfterFailedDelete(conversationId: string): void {
    this.deletedConversationIds.delete(conversationId);
  }

  async persistUserMessage(params: {
    targetUserId: string;
    conversationId: string;
    conversationTitle: string;
    conversationFolderId: string | null;
    conversationCreatedAt: string;
    userMessage: ChatMessage;
    isCurrentScope: () => boolean;
    conversationExistsLocally: (id: string) => boolean;
    adapter: ConversationPersistenceAdapter;
    onSaved: (savedMessage: MessageRow) => void;
  }): Promise<'saved' | 'skipped' | 'aborted-deleted'> {
    const {
      targetUserId,
      conversationId,
      conversationTitle,
      conversationFolderId,
      conversationCreatedAt,
      userMessage,
      isCurrentScope,
      conversationExistsLocally,
      adapter,
      onSaved,
    } = params;

    if (this.inFlightMessageIds.has(userMessage.id)) {
      return 'skipped';
    }
    if (this.deletedConversationIds.has(conversationId)) {
      return 'aborted-deleted';
    }
    if (this.persistedMessageIds.has(userMessage.id)) {
      return 'saved';
    }

    this.inFlightMessageIds.add(userMessage.id);

    try {
      let outcome: 'saved' | 'skipped' | 'aborted-deleted' = 'skipped';

      await this.enqueue(conversationId, async () => {
        if (!isCurrentScope()) {
          outcome = 'skipped';
          return;
        }

        if (
          this.deletedConversationIds.has(conversationId) ||
          !conversationExistsLocally(conversationId)
        ) {
          outcome = 'aborted-deleted';
          return;
        }

        let createdConversationNow = false;
        if (!this.persistedConversationIds.has(conversationId)) {
          await adapter.createConversation(
            targetUserId,
            conversationTitle,
            conversationFolderId,
            {
              id: conversationId,
              createdAt: conversationCreatedAt,
              updatedAt: userMessage.createdAt,
            },
          );

          // Mark as persisted immediately so any queued delete cleans up the DB row
          // even if the user switched accounts or deleted mid-request.
          this.persistedConversationIds.add(conversationId);
          createdConversationNow = true;

          if (!isCurrentScope()) {
            outcome = 'skipped';
            return;
          }

          if (
            this.deletedConversationIds.has(conversationId) ||
            !conversationExistsLocally(conversationId)
          ) {
            outcome = 'aborted-deleted';
            return;
          }
        }

        if (this.persistedMessageIds.has(userMessage.id)) {
          outcome = 'saved';
          return;
        }

        const savedMessage = await adapter.createMessage(
          targetUserId,
          conversationId,
          'user',
          userMessage.content,
          userMessage.createdAt,
          { id: userMessage.id, touchConversation: !createdConversationNow },
        );

        this.persistedMessageIds.add(savedMessage.id);

        if (
          !isCurrentScope() ||
          this.deletedConversationIds.has(conversationId) ||
          !conversationExistsLocally(conversationId)
        ) {
          outcome = 'aborted-deleted';
          return;
        }

        outcome = 'saved';
        onSaved(savedMessage);
      });

      return outcome;
    } finally {
      this.inFlightMessageIds.delete(userMessage.id);
    }
  }

  async persistAssistantMessage(params: {
    targetUserId: string;
    conversationId: string;
    assistantMessage: ChatMessage;
    isCurrentScope: () => boolean;
    conversationExistsLocally: (id: string) => boolean;
    adapter: ConversationPersistenceAdapter;
    onSaved: (savedMessage: MessageRow) => void;
  }): Promise<'saved' | 'skipped' | 'aborted-deleted'> {
    const {
      targetUserId,
      conversationId,
      assistantMessage,
      isCurrentScope,
      conversationExistsLocally,
      adapter,
      onSaved,
    } = params;

    if (this.inFlightMessageIds.has(assistantMessage.id)) {
      return 'skipped';
    }
    if (this.deletedConversationIds.has(conversationId)) {
      return 'aborted-deleted';
    }
    if (this.persistedMessageIds.has(assistantMessage.id)) {
      return 'saved';
    }

    this.inFlightMessageIds.add(assistantMessage.id);

    try {
      let outcome: 'saved' | 'skipped' | 'aborted-deleted' = 'skipped';

      await this.enqueue(conversationId, async () => {
        if (!isCurrentScope()) {
          outcome = 'skipped';
          return;
        }
        if (
          this.deletedConversationIds.has(conversationId) ||
          !conversationExistsLocally(conversationId)
        ) {
          outcome = 'aborted-deleted';
          return;
        }
        if (!this.persistedConversationIds.has(conversationId)) {
          throw new Error('Parent conversation has not been saved yet.');
        }
        if (this.persistedMessageIds.has(assistantMessage.id)) {
          outcome = 'saved';
          return;
        }

        const savedRow = await adapter.createMessage(
          targetUserId,
          conversationId,
          'assistant',
          assistantMessage.content,
          assistantMessage.createdAt,
          { id: assistantMessage.id, touchConversation: true },
        );

        this.persistedMessageIds.add(savedRow.id);

        if (
          !isCurrentScope() ||
          this.deletedConversationIds.has(conversationId) ||
          !conversationExistsLocally(conversationId)
        ) {
          outcome = 'aborted-deleted';
          return;
        }

        outcome = 'saved';
        onSaved(savedRow);
      });

      return outcome;
    } finally {
      this.inFlightMessageIds.delete(assistantMessage.id);
    }
  }

  async deleteConversation(params: {
    targetUserId: string;
    conversationId: string;
    hadPersistedOrQueued: boolean;
    isCurrentScope: () => boolean;
    adapter: ConversationPersistenceAdapter;
    onDeleted: () => void;
  }): Promise<'deleted' | 'skipped-never-persisted'> {
    const {
      targetUserId,
      conversationId,
      hadPersistedOrQueued,
      isCurrentScope,
      adapter,
      onDeleted,
    } = params;

    if (!hadPersistedOrQueued) {
      onDeleted();
      return 'skipped-never-persisted';
    }

    let deletedFromDb = false;

    await this.enqueue(conversationId, async () => {
      if (!isCurrentScope()) {
        return;
      }

      if (!this.persistedConversationIds.has(conversationId)) {
        // Initial creation was skipped or failed before reaching DB; nothing to delete.
        onDeleted();
        return;
      }

      await adapter.deleteConversation(targetUserId, conversationId);
      this.persistedConversationIds.delete(conversationId);
      deletedFromDb = true;

      if (!isCurrentScope()) {
        return;
      }

      onDeleted();
    });

    return deletedFromDb ? 'deleted' : 'skipped-never-persisted';
  }

  async renameConversation(params: {
    targetUserId: string;
    conversationId: string;
    title: string;
    updatedAt: string;
    isCurrentScope: () => boolean;
    adapter: ConversationPersistenceAdapter;
    onRenamed: (saved: ConversationRow) => void;
  }): Promise<'renamed' | 'skipped-deleted'> {
    const {
      targetUserId,
      conversationId,
      title,
      updatedAt,
      isCurrentScope,
      adapter,
      onRenamed,
    } = params;

    let outcome: 'renamed' | 'skipped-deleted' = 'skipped-deleted';

    await this.enqueue(conversationId, async () => {
      if (!isCurrentScope() || this.deletedConversationIds.has(conversationId)) {
        return;
      }
      if (!this.persistedConversationIds.has(conversationId)) {
        throw new Error('Conversation has not finished saving yet.');
      }

      const saved = await adapter.updateConversation(targetUserId, conversationId, {
        title,
        updated_at: updatedAt,
      });

      if (!isCurrentScope() || this.deletedConversationIds.has(conversationId)) {
        return;
      }

      outcome = 'renamed';
      onRenamed(saved);
    });

    return outcome;
  }

  async moveConversation(params: {
    targetUserId: string;
    conversationId: string;
    folderId: string | null;
    isCurrentScope: () => boolean;
    ensureFolderReady: () => Promise<void>;
    adapter: ConversationPersistenceAdapter;
    onMoved: (saved: ConversationRow) => void;
  }): Promise<'moved' | 'skipped-deleted'> {
    const {
      targetUserId,
      conversationId,
      folderId,
      isCurrentScope,
      ensureFolderReady,
      adapter,
      onMoved,
    } = params;

    let outcome: 'moved' | 'skipped-deleted' = 'skipped-deleted';

    await this.enqueue(conversationId, async () => {
      if (!isCurrentScope() || this.deletedConversationIds.has(conversationId)) {
        return;
      }

      await ensureFolderReady();

      if (!isCurrentScope() || this.deletedConversationIds.has(conversationId)) {
        return;
      }
      if (!this.persistedConversationIds.has(conversationId)) {
        throw new Error('Conversation has not finished saving yet.');
      }

      const saved = await adapter.moveConversation(
        targetUserId,
        conversationId,
        folderId,
      );

      if (!isCurrentScope() || this.deletedConversationIds.has(conversationId)) {
        return;
      }

      outcome = 'moved';
      onMoved(saved);
    });

    return outcome;
  }
}
