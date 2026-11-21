import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';
import type {
  ConversationRow,
  Database,
  DatabaseMessageRole,
  FolderRow,
  MessageRow,
} from '../types/database';
import { generateId } from '../utils/id';
import { touchConversationTimestamp } from './touchConversation';

export interface ConversationUpdates {
  title?: string;
  folder_id?: string | null;
  updated_at?: string;
}

export interface CreateMessageInput {
  id?: string;
  conversationId: string;
  role: DatabaseMessageRole;
  content: string;
  createdAt?: string;
}

const FOLDER_COLUMNS = 'id, user_id, name, created_at';
const CONVERSATION_COLUMNS = 'id, user_id, folder_id, title, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, conversation_id, user_id, role, content, created_at';

function getConfiguredClient(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }
  return supabase;
}

function assertNonEmptyId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function getFolders(userId: string): Promise<FolderRow[]> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');

  const { data, error } = await client
    .from('folders')
    .select(FOLDER_COLUMNS)
    .eq('user_id', uid)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load folders: ${error.message}`);
  }

  return data ?? [];
}

export async function createFolder(
  userId: string,
  name: string,
  options?: { id?: string; createdAt?: string },
): Promise<FolderRow> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Folder name cannot be empty.');
  }

  const payload: Database['public']['Tables']['folders']['Insert'] = {
    id: options?.id ?? generateId(),
    user_id: uid,
    name: trimmedName,
  };
  if (options?.createdAt) {
    payload.created_at = options.createdAt;
  }

  const { data, error } = await client
    .from('folders')
    .insert(payload)
    .select(FOLDER_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to create folder: ${error.message}`);
  }

  return data;
}

export async function renameFolder(
  userId: string,
  folderId: string,
  name: string,
): Promise<FolderRow> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const fid = assertNonEmptyId(folderId, 'Folder ID');
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Folder name cannot be empty.');
  }

  const { data, error } = await client
    .from('folders')
    .update({ name: trimmedName })
    .eq('id', fid)
    .eq('user_id', uid)
    .select(FOLDER_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to rename folder: ${error.message}`);
  }

  return data;
}

export async function deleteFolder(userId: string, folderId: string): Promise<void> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const fid = assertNonEmptyId(folderId, 'Folder ID');

  const { error } = await client
    .from('folders')
    .delete()
    .eq('id', fid)
    .eq('user_id', uid);

  if (error) {
    throw new Error(`Failed to delete folder: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function getConversations(userId: string): Promise<ConversationRow[]> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');

  const { data, error } = await client
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('user_id', uid)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load conversations: ${error.message}`);
  }

  return data ?? [];
}

export async function createConversation(
  userId: string,
  title = 'New chat',
  folderId: string | null = null,
  options?: { id?: string; createdAt?: string; updatedAt?: string },
): Promise<ConversationRow> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const normalizedTitle = title.trim() || 'New chat';

  const now = options?.createdAt ?? new Date().toISOString();
  const payload: Database['public']['Tables']['conversations']['Insert'] = {
    id: options?.id ?? generateId(),
    user_id: uid,
    folder_id: folderId ?? null,
    title: normalizedTitle,
    created_at: now,
    updated_at: options?.updatedAt ?? now,
  };

  const { data, error } = await client
    .from('conversations')
    .insert(payload)
    .select(CONVERSATION_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to create conversation: ${error.message}`);
  }

  return data;
}

export async function updateConversation(
  userId: string,
  conversationId: string,
  updates: ConversationUpdates,
): Promise<ConversationRow> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const cid = assertNonEmptyId(conversationId, 'Conversation ID');

  const payload: Database['public']['Tables']['conversations']['Update'] = {
    updated_at: updates.updated_at ?? new Date().toISOString(),
  };

  if (updates.title !== undefined) {
    const trimmedTitle = updates.title.trim();
    if (!trimmedTitle) {
      throw new Error('Conversation title cannot be empty.');
    }
    payload.title = trimmedTitle;
  }

  if (updates.folder_id !== undefined) {
    payload.folder_id = updates.folder_id;
  }

  const { data, error } = await client
    .from('conversations')
    .update(payload)
    .eq('id', cid)
    .eq('user_id', uid)
    .select(CONVERSATION_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to update conversation: ${error.message}`);
  }

  return data;
}

export async function deleteConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const cid = assertNonEmptyId(conversationId, 'Conversation ID');

  const { error } = await client
    .from('conversations')
    .delete()
    .eq('id', cid)
    .eq('user_id', uid);

  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }
}

export async function moveConversation(
  userId: string,
  conversationId: string,
  folderId: string | null,
): Promise<ConversationRow> {
  return updateConversation(userId, conversationId, { folder_id: folderId });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function getMessages(userId: string): Promise<MessageRow[]> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');

  const { data, error } = await client
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', uid)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load messages: ${error.message}`);
  }

  return data ?? [];
}

export async function getMessagesByConversation(
  userId: string,
  conversationId: string,
): Promise<MessageRow[]> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const cid = assertNonEmptyId(conversationId, 'Conversation ID');

  const { data, error } = await client
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', uid)
    .eq('conversation_id', cid)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load conversation messages: ${error.message}`);
  }

  return data ?? [];
}

export async function createMessage(
  userId: string,
  conversationId: string,
  role: DatabaseMessageRole,
  content: string,
  createdAt?: string,
  options?: { id?: string; touchConversation?: boolean },
): Promise<MessageRow> {
  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const cid = assertNonEmptyId(conversationId, 'Conversation ID');
  const timestamp = createdAt ?? new Date().toISOString();

  const payload: Database['public']['Tables']['messages']['Insert'] = {
    id: options?.id ?? generateId(),
    conversation_id: cid,
    user_id: uid,
    role,
    content,
    created_at: timestamp,
  };

  const { data, error } = await client
    .from('messages')
    .insert(payload)
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }

  if (options?.touchConversation !== false) {
    await touchConversationTimestamp(cid, () =>
      client
        .from('conversations')
        .update({ updated_at: timestamp })
        .eq('id', cid)
        .eq('user_id', uid),
    );
  }

  return data;
}

export async function createMessages(
  userId: string,
  messages: CreateMessageInput[],
  options?: { touchConversation?: boolean },
): Promise<MessageRow[]> {
  if (messages.length === 0) {
    return [];
  }

  const client = getConfiguredClient();
  const uid = assertNonEmptyId(userId, 'User ID');
  const baseTime = Date.now();

  const rows: Database['public']['Tables']['messages']['Insert'][] = messages.map(
    (msg, index) => ({
      id: msg.id ?? generateId(),
      conversation_id: assertNonEmptyId(msg.conversationId, 'Conversation ID'),
      user_id: uid,
      role: msg.role,
      content: msg.content,
      created_at: msg.createdAt ?? new Date(baseTime + index).toISOString(),
    }),
  );

  const { data, error } = await client
    .from('messages')
    .insert(rows)
    .select(MESSAGE_COLUMNS);

  if (error) {
    throw new Error(`Failed to save messages: ${error.message}`);
  }

  const inserted = [...(data ?? [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  if (options?.touchConversation !== false && inserted.length > 0) {
    const latestByConversation = new Map<string, string>();
    for (const row of inserted) {
      const prev = latestByConversation.get(row.conversation_id);
      if (!prev || row.created_at > prev) {
        latestByConversation.set(row.conversation_id, row.created_at);
      }
    }

    await Promise.all(
      Array.from(latestByConversation.entries()).map(([cid, latestTimestamp]) =>
        touchConversationTimestamp(cid, () =>
          client
            .from('conversations')
            .update({ updated_at: latestTimestamp })
            .eq('id', cid)
            .eq('user_id', uid),
        ),
      ),
    );
  }

  return inserted;
}

/**
 * Atomically orders parent conversation creation before child message insertion
 * so foreign-key and RLS parent-ownership policies are always satisfied.
 */
export async function createConversationWithMessages(
  userId: string,
  params: {
    id?: string;
    title?: string;
    folderId?: string | null;
    createdAt?: string;
    messages: Array<{
      id?: string;
      role: DatabaseMessageRole;
      content: string;
      createdAt?: string;
    }>;
  },
): Promise<{ conversation: ConversationRow; messages: MessageRow[] }> {
  const baseTimestamp = params.createdAt ?? new Date().toISOString();
  const conversation = await createConversation(
    userId,
    params.title ?? 'New chat',
    params.folderId ?? null,
    {
      id: params.id,
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp,
    },
  );

  if (params.messages.length === 0) {
    return { conversation, messages: [] };
  }

  const createdMessages = await createMessages(
    userId,
    params.messages.map((m) => ({
      id: m.id,
      conversationId: conversation.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  );

  const latestMessageTimestamp =
    createdMessages[createdMessages.length - 1]?.created_at ?? conversation.updated_at;

  return {
    conversation: {
      ...conversation,
      updated_at: latestMessageTimestamp,
    },
    messages: createdMessages,
  };
}
