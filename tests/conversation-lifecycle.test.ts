import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConversationSyncQueue,
  type ConversationPersistenceAdapter,
} from '../src/services/conversationSyncQueue';
import type { ChatMessage } from '../src/types';
import type { ConversationRow, MessageRow } from '../src/types/database';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMockDb() {
  const conversations = new Map<string, ConversationRow>();
  const messages = new Map<string, MessageRow>();
  const operations: string[] = [];

  const adapter: ConversationPersistenceAdapter = {
    async createConversation(userId, title, folderId, options) {
      const id = options?.id ?? 'conv-generated';
      operations.push(`createConversation:${id}`);
      const row: ConversationRow = {
        id,
        user_id: userId,
        folder_id: folderId,
        title,
        created_at: options?.createdAt ?? '2026-11-21T10:00:00.000Z',
        updated_at: options?.updatedAt ?? '2026-11-21T10:00:00.000Z',
      };
      conversations.set(id, row);
      return row;
    },
    async createMessage(userId, conversationId, role, content, createdAt, options) {
      if (!conversations.has(conversationId)) {
        throw new Error(`Foreign key violation: missing ${conversationId}`);
      }
      const id = options?.id ?? 'msg-generated';
      operations.push(`createMessage:${id}:${role}`);
      const row: MessageRow = {
        id,
        user_id: userId,
        conversation_id: conversationId,
        role,
        content,
        created_at: createdAt ?? '2026-11-21T10:00:01.000Z',
      };
      messages.set(id, row);
      return row;
    },
    async updateConversation(_userId, conversationId, updates) {
      const existing = conversations.get(conversationId);
      if (!existing) {
        throw new Error(`Missing conversation ${conversationId}`);
      }
      operations.push(`updateConversation:${conversationId}`);
      const updated: ConversationRow = {
        ...existing,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.folder_id !== undefined ? { folder_id: updates.folder_id } : {}),
        updated_at: updates.updated_at ?? '2026-11-21T10:00:02.000Z',
      };
      conversations.set(conversationId, updated);
      return updated;
    },
    async moveConversation(userId, conversationId, folderId) {
      operations.push(`moveConversation:${conversationId}:${folderId ?? 'null'}`);
      return adapter.updateConversation(userId, conversationId, {
        folder_id: folderId,
      });
    },
    async deleteConversation(_userId, conversationId) {
      operations.push(`deleteConversation:${conversationId}`);
      conversations.delete(conversationId);
      for (const [msgId, msg] of messages.entries()) {
        if (msg.conversation_id === conversationId) {
          messages.delete(msgId);
        }
      }
    },
  };

  return { adapter, conversations, messages, operations };
}

test('create conversation -> send first message -> immediate delete leaves zero orphans in DB', async () => {
  const queue = new ConversationSyncQueue();
  const db = makeMockDb();
  const localConvIds = new Set(['conv-fast-1']);

  const userMsg: ChatMessage = {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    createdAt: '2026-11-21T10:00:00.000Z',
    status: 'sending',
  };

  const persistPromise = queue.persistUserMessage({
    targetUserId: 'user-1',
    conversationId: 'conv-fast-1',
    conversationTitle: 'Hello',
    conversationFolderId: null,
    conversationCreatedAt: '2026-11-21T10:00:00.000Z',
    userMessage: userMsg,
    isCurrentScope: () => true,
    conversationExistsLocally: (id) => localConvIds.has(id),
    adapter: db.adapter,
    onSaved: () => undefined,
  });

  // Immediately delete synchronously before async queue continuation executes
  localConvIds.delete('conv-fast-1');
  const { hadPersistedOrQueued } = queue.markDeletedLocally('conv-fast-1');
  assert.equal(hadPersistedOrQueued, true);

  let deleteCallbackRan = false;
  const deletePromise = queue.deleteConversation({
    targetUserId: 'user-1',
    conversationId: 'conv-fast-1',
    hadPersistedOrQueued,
    isCurrentScope: () => true,
    adapter: db.adapter,
    onDeleted: () => {
      deleteCallbackRan = true;
    },
  });

  const [persistOutcome, deleteOutcome] = await Promise.all([
    persistPromise,
    deletePromise,
  ]);

  assert.equal(persistOutcome, 'aborted-deleted');
  assert.equal(deleteOutcome, 'skipped-never-persisted');
  assert.equal(deleteCallbackRan, true);
  assert.equal(db.conversations.size, 0);
  assert.equal(db.messages.size, 0);
  assert.deepEqual(db.operations, []);
});

test('delete while first conversation DB insert is pending in-flight skips message insert and deletes DB row', async () => {
  const queue = new ConversationSyncQueue();
  const db = makeMockDb();
  const localConvIds = new Set(['conv-inflight-1']);
  const insertEntered = createDeferred<void>();
  const releaseInsert = createDeferred<void>();

  const slowAdapter: ConversationPersistenceAdapter = {
    ...db.adapter,
    async createConversation(userId, title, folderId, options) {
      insertEntered.resolve();
      await releaseInsert.promise;
      return db.adapter.createConversation(userId, title, folderId, options);
    },
  };

  const userMsg: ChatMessage = {
    id: 'msg-inflight-1',
    role: 'user',
    content: 'First prompt',
    createdAt: '2026-11-21T10:00:00.000Z',
    status: 'sending',
  };

  const persistPromise = queue.persistUserMessage({
    targetUserId: 'user-1',
    conversationId: 'conv-inflight-1',
    conversationTitle: 'First prompt',
    conversationFolderId: null,
    conversationCreatedAt: '2026-11-21T10:00:00.000Z',
    userMessage: userMsg,
    isCurrentScope: () => true,
    conversationExistsLocally: (id) => localConvIds.has(id),
    adapter: slowAdapter,
    onSaved: () => undefined,
  });

  await insertEntered.promise;

  // User deletes while createConversation is still pending over the network
  localConvIds.delete('conv-inflight-1');
  const { hadPersistedOrQueued } = queue.markDeletedLocally('conv-inflight-1');
  assert.equal(hadPersistedOrQueued, true);

  const deletePromise = queue.deleteConversation({
    targetUserId: 'user-1',
    conversationId: 'conv-inflight-1',
    hadPersistedOrQueued,
    isCurrentScope: () => true,
    adapter: slowAdapter,
    onDeleted: () => undefined,
  });

  // Resolve the in-flight DB insert
  releaseInsert.resolve();

  const [persistOutcome, deleteOutcome] = await Promise.all([
    persistPromise,
    deletePromise,
  ]);

  assert.equal(persistOutcome, 'aborted-deleted');
  assert.equal(deleteOutcome, 'deleted');
  assert.equal(db.conversations.size, 0);
  assert.equal(db.messages.size, 0);
  assert.deepEqual(db.operations, [
    'createConversation:conv-inflight-1',
    'deleteConversation:conv-inflight-1',
  ]);
});

test('rapid send + queued assistant persistence followed by delete leaves no orphan conversation', async () => {
  const queue = new ConversationSyncQueue();
  const db = makeMockDb();
  const localConvIds = new Set(['conv-rapid-1']);

  const userPromise = queue.persistUserMessage({
    targetUserId: 'user-1',
    conversationId: 'conv-rapid-1',
    conversationTitle: 'Rapid',
    conversationFolderId: null,
    conversationCreatedAt: '2026-11-21T10:00:00.000Z',
    userMessage: {
      id: 'msg-u1',
      role: 'user',
      content: 'Hi',
      createdAt: '2026-11-21T10:00:00.000Z',
      status: 'sending',
    },
    isCurrentScope: () => true,
    conversationExistsLocally: (id) => localConvIds.has(id),
    adapter: db.adapter,
    onSaved: () => undefined,
  });

  const assistantPromise = queue.persistAssistantMessage({
    targetUserId: 'user-1',
    conversationId: 'conv-rapid-1',
    assistantMessage: {
      id: 'msg-a1',
      role: 'assistant',
      content: 'Hello back',
      createdAt: '2026-11-21T10:00:01.000Z',
      status: 'complete',
    },
    isCurrentScope: () => true,
    conversationExistsLocally: (id) => localConvIds.has(id),
    adapter: db.adapter,
    onSaved: () => undefined,
  });

  localConvIds.delete('conv-rapid-1');
  const { hadPersistedOrQueued } = queue.markDeletedLocally('conv-rapid-1');
  const deletePromise = queue.deleteConversation({
    targetUserId: 'user-1',
    conversationId: 'conv-rapid-1',
    hadPersistedOrQueued,
    isCurrentScope: () => true,
    adapter: db.adapter,
    onDeleted: () => undefined,
  });

  const [uRes, aRes, dRes] = await Promise.all([
    userPromise,
    assistantPromise,
    deletePromise,
  ]);

  assert.equal(uRes, 'aborted-deleted');
  assert.equal(aRes, 'aborted-deleted');
  assert.equal(dRes, 'skipped-never-persisted');
  assert.equal(db.conversations.size, 0);
  assert.equal(db.messages.size, 0);
});

test('normal message persistence, rename, and move execute in serialized order', async () => {
  const queue = new ConversationSyncQueue();
  const db = makeMockDb();
  const localConvIds = new Set(['conv-normal-1']);
  const savedIds: string[] = [];

  const userPromise = queue.persistUserMessage({
    targetUserId: 'user-1',
    conversationId: 'conv-normal-1',
    conversationTitle: 'Initial Title',
    conversationFolderId: null,
    conversationCreatedAt: '2026-11-21T10:00:00.000Z',
    userMessage: {
      id: 'msg-u-normal',
      role: 'user',
      content: 'Explain TypeScript generics',
      createdAt: '2026-11-21T10:00:00.000Z',
      status: 'sending',
    },
    isCurrentScope: () => true,
    conversationExistsLocally: (id) => localConvIds.has(id),
    adapter: db.adapter,
    onSaved: (row) => savedIds.push(row.id),
  });

  const renamePromise = queue.renameConversation({
    targetUserId: 'user-1',
    conversationId: 'conv-normal-1',
    title: 'TypeScript Generics Guide',
    updatedAt: '2026-11-21T10:00:02.000Z',
    isCurrentScope: () => true,
    adapter: db.adapter,
    onRenamed: () => undefined,
  });

  const movePromise = queue.moveConversation({
    targetUserId: 'user-1',
    conversationId: 'conv-normal-1',
    folderId: 'folder-work',
    isCurrentScope: () => true,
    ensureFolderReady: async () => undefined,
    adapter: db.adapter,
    onMoved: () => undefined,
  });

  const assistantPromise = queue.persistAssistantMessage({
    targetUserId: 'user-1',
    conversationId: 'conv-normal-1',
    assistantMessage: {
      id: 'msg-a-normal',
      role: 'assistant',
      content: 'Generics allow reusable typed components.',
      createdAt: '2026-11-21T10:00:03.000Z',
      status: 'complete',
    },
    isCurrentScope: () => true,
    conversationExistsLocally: (id) => localConvIds.has(id),
    adapter: db.adapter,
    onSaved: (row) => savedIds.push(row.id),
  });

  const [uRes, rRes, mRes, aRes] = await Promise.all([
    userPromise,
    renamePromise,
    movePromise,
    assistantPromise,
  ]);

  assert.equal(uRes, 'saved');
  assert.equal(rRes, 'renamed');
  assert.equal(mRes, 'moved');
  assert.equal(aRes, 'saved');
  assert.deepEqual(savedIds, ['msg-u-normal', 'msg-a-normal']);

  const savedConv = db.conversations.get('conv-normal-1');
  assert.equal(savedConv?.title, 'TypeScript Generics Guide');
  assert.equal(savedConv?.folder_id, 'folder-work');
  assert.equal(db.messages.size, 2);
  assert.deepEqual(db.operations, [
    'createConversation:conv-normal-1',
    'createMessage:msg-u-normal:user',
    'updateConversation:conv-normal-1',
    'moveConversation:conv-normal-1:folder-work',
    'updateConversation:conv-normal-1',
    'createMessage:msg-a-normal:assistant',
  ]);
});
