import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConversationMessageCache,
  mergeLoadedMessages,
} from '../src/services/conversationMessageCache';
import { touchConversationTimestamp } from '../src/services/touchConversation';
import type { ChatMessage } from '../src/types';
import type { MessageRow } from '../src/types/database';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('ConversationMessageCache lazily loads, caches, and deduplicates per-conversation fetches', async () => {
  const cache = new ConversationMessageCache();
  const fetchCalls: string[] = [];
  const loadedByConv = new Map<string, ChatMessage[]>();

  const mockRows: Record<string, MessageRow[]> = {
    'conv-1': [
      {
        id: 'm1',
        conversation_id: 'conv-1',
        user_id: 'user-a',
        role: 'user',
        content: 'First question',
        created_at: '2026-11-21T10:00:00.000Z',
      },
      {
        id: 'm2',
        conversation_id: 'conv-1',
        user_id: 'user-a',
        role: 'assistant',
        content: 'First answer',
        created_at: '2026-11-21T10:00:01.000Z',
      },
    ],
    'conv-2': [
      {
        id: 'm3',
        conversation_id: 'conv-2',
        user_id: 'user-a',
        role: 'user',
        content: 'Second conversation prompt',
        created_at: '2026-11-21T10:05:00.000Z',
      },
    ],
  };

  const gate = createDeferred<void>();
  const fetchMessagesByConversation = async (userId: string, convId: string) => {
    fetchCalls.push(`${userId}:${convId}`);
    if (convId === 'conv-1') {
      await gate.promise;
    }
    return mockRows[convId] ?? [];
  };

  // Concurrent double selection of conv-1 deduplicates into one DB call
  const p1 = cache.ensureLoaded({
    userId: 'user-a',
    conversationId: 'conv-1',
    fetchMessagesByConversation,
    isCurrentUser: (uid) => uid === 'user-a',
    isDeleted: () => false,
    onLoaded: (_rows, mapped) => loadedByConv.set('conv-1', mapped),
  });
  assert.equal(cache.getState('conv-1').status, 'loading');

  const p2 = cache.ensureLoaded({
    userId: 'user-a',
    conversationId: 'conv-1',
    fetchMessagesByConversation,
    isCurrentUser: (uid) => uid === 'user-a',
    isDeleted: () => false,
    onLoaded: (_rows, mapped) => loadedByConv.set('conv-1', mapped),
  });

  gate.resolve();
  const [ok1, ok2] = await Promise.all([p1, p2]);
  assert.equal(ok1, true);
  assert.equal(ok2, true);
  assert.deepEqual(fetchCalls, ['user-a:conv-1']);
  assert.equal(cache.getState('conv-1').status, 'loaded');
  assert.equal(loadedByConv.get('conv-1')?.length, 2);

  // Revisiting conv-1 hits cache without re-fetching
  const okCached = await cache.ensureLoaded({
    userId: 'user-a',
    conversationId: 'conv-1',
    fetchMessagesByConversation,
    isCurrentUser: (uid) => uid === 'user-a',
    isDeleted: () => false,
    onLoaded: (_rows, mapped) => loadedByConv.set('conv-1', mapped),
  });
  assert.equal(okCached, true);
  assert.deepEqual(fetchCalls, ['user-a:conv-1']);

  // Switching to conv-2 loads conv-2 independently
  const okConv2 = await cache.ensureLoaded({
    userId: 'user-a',
    conversationId: 'conv-2',
    fetchMessagesByConversation,
    isCurrentUser: (uid) => uid === 'user-a',
    isDeleted: () => false,
    onLoaded: (_rows, mapped) => loadedByConv.set('conv-2', mapped),
  });
  assert.equal(okConv2, true);
  assert.deepEqual(fetchCalls, ['user-a:conv-1', 'user-a:conv-2']);
  assert.equal(loadedByConv.get('conv-2')?.[0]?.content, 'Second conversation prompt');
});

test('ConversationMessageCache surfaces load errors and isolates cache across sign-out / account switches', async () => {
  const cache = new ConversationMessageCache();
  let currentUserId: string | null = 'user-a';

  // Failed query enters error state without marking loaded
  const failed = await cache.ensureLoaded({
    userId: 'user-a',
    conversationId: 'conv-err',
    fetchMessagesByConversation: async () => {
      throw new Error('Network timeout');
    },
    isCurrentUser: (uid) => currentUserId === uid,
    isDeleted: () => false,
    onLoaded: () => undefined,
  });
  assert.equal(failed, false);
  assert.deepEqual(cache.getState('conv-err'), {
    status: 'error',
    error: 'Network timeout',
  });

  // In-flight load from user-a must be discarded after sign-out / account switch
  const inflightGate = createDeferred<MessageRow[]>();
  let leakedToUserB = false;

  const userALoad = cache.ensureLoaded({
    userId: 'user-a',
    conversationId: 'conv-a-secret',
    fetchMessagesByConversation: () => inflightGate.promise,
    isCurrentUser: (uid) => currentUserId === uid,
    isDeleted: () => false,
    onLoaded: () => {
      leakedToUserB = true;
    },
  });

  // User signs out and user-b signs in
  currentUserId = 'user-b';
  cache.reset();

  inflightGate.resolve([
    {
      id: 'secret-m1',
      conversation_id: 'conv-a-secret',
      user_id: 'user-a',
      role: 'user',
      content: 'Private user A data',
      created_at: '2026-11-21T10:00:00.000Z',
    },
  ]);

  const outcomeAfterSwitch = await userALoad;
  assert.equal(outcomeAfterSwitch, false);
  assert.equal(leakedToUserB, false);
  assert.equal(cache.getState('conv-a-secret').status, 'idle');
});

test('mergeLoadedMessages preserves unsaved/sending local messages and sorts chronologically', () => {
  const localMessages: ChatMessage[] = [
    {
      id: 'local-sending',
      role: 'user',
      content: 'Newly typed message',
      createdAt: '2026-11-21T10:02:00.000Z',
      status: 'sending',
    },
  ];
  const fetchedMessages: ChatMessage[] = [
    {
      id: 'db-2',
      role: 'assistant',
      content: 'Older reply',
      createdAt: '2026-11-21T10:01:00.000Z',
      status: 'complete',
      saveStatus: 'saved',
    },
    {
      id: 'db-1',
      role: 'user',
      content: 'Older prompt',
      createdAt: '2026-11-21T10:00:00.000Z',
      status: 'complete',
      saveStatus: 'saved',
    },
  ];

  const merged = mergeLoadedMessages(localMessages, fetchedMessages);
  assert.deepEqual(
    merged.map((m) => m.id),
    ['db-1', 'db-2', 'local-sending'],
  );
});

test('touchConversationTimestamp logs DB errors or exceptions cleanly without throwing', async () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const ok1 = await touchConversationTimestamp('conv-1', async () => ({
      error: { message: 'RLS update denied' },
    }));
    assert.equal(ok1, false);
    assert.equal(warnings.length, 1);

    const ok2 = await touchConversationTimestamp('conv-1', async () => {
      throw new Error('Socket hangup');
    });
    assert.equal(ok2, false);
    assert.equal(warnings.length, 2);

    const ok3 = await touchConversationTimestamp('conv-1', async () => ({
      error: null,
    }));
    assert.equal(ok3, true);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = originalWarn;
  }
});
