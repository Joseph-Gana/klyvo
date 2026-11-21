import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  DEFAULT_SETTINGS,
  DEFAULT_USER_PROFILE,
  INITIAL_CONVERSATIONS,
  INITIAL_FOLDERS,
} from '../data/mockData';
import {
  ChatApiError,
  type ChatApiTurn,
  streamGeminiChat,
} from '../services/chatApiService';
import { storageService } from '../services/storageService';
import {
  ConversationMessageCache,
  mergeLoadedMessages,
  type ConversationMessagesSnapshot,
} from '../services/conversationMessageCache';
import {
  ConversationSyncQueue,
  type ConversationPersistenceAdapter,
} from '../services/conversationSyncQueue';
import {
  createConversation as createConversationInDb,
  createFolder as createFolderInDb,
  createMessage as createMessageInDb,
  deleteConversation as deleteConversationInDb,
  deleteFolder as deleteFolderInDb,
  getConversations,
  getFolders,
  getMessagesByConversation,
  moveConversation as moveConversationInDb,
  renameFolder as renameFolderInDb,
  updateConversation as updateConversationInDb,
} from '../services/workspaceService';
import {
  AppSettings,
  ChatDiagnosticsSummary,
  ChatMessage,
  Conversation,
  Folder,
  UserProfile,
  WorkspaceRoute,
} from '../types';
import type { ConversationRow, FolderRow } from '../types/database';
import { generateId } from '../utils/id';
import { useAuth } from './AuthContext';

interface WorkspaceContextValue {
  activeRoute: WorkspaceRoute;
  setActiveRoute: (route: WorkspaceRoute) => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  isWorkspaceLoading: boolean;
  workspaceError: string | null;
  isActiveConversationMessagesLoading: boolean;
  activeConversationMessagesError: string | null;
  retryLoadActiveConversationMessages: () => void;
  isAuthenticatedWorkspace: boolean;
  streamingConversationId: string | null;
  isStreamingActive: boolean;
  refreshWorkspace: () => Promise<void>;
  selectConversation: (id: string | null) => void;
  startNewChat: () => void;
  sendUserMessage: (content: string) => Promise<void> | void;
  stopGeneration: () => void;
  retryNoticeMessage: (conversationId: string, messageId: string) => void;
  retrySaveMessage: (conversationId: string, messageId: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  moveConversationToFolder: (conversationId: string, folderId: string | null) => void;
  folders: Folder[];
  createFolder: (name: string) => Folder | null;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  userProfile: UserProfile;
  updateUserProfile: (updates: Partial<UserProfile>) => void;
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => void;
  resetDemoData: () => void;
  toastMessage: string | null;
  showToast: (message: string) => void;
  isVoiceModalOpen: boolean;
  setVoiceModalOpen: (open: boolean) => void;
  isAuthPreviewOpen: boolean;
  setAuthPreviewOpen: (open: boolean) => void;
  latestChatDiagnostics: ChatDiagnosticsSummary | null;
  clearLatestChatDiagnostics: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

function mapFolderRow(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

function mapConversationMetadataRows(conversationRows: ConversationRow[]): Conversation[] {
  return conversationRows.map((row) => ({
    id: row.id,
    title: row.title,
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: [],
  }));
}

const CONVERSATION_DB_ADAPTER: ConversationPersistenceAdapter = {
  createConversation: createConversationInDb,
  createMessage: createMessageInDb,
  updateConversation: updateConversationInDb,
  moveConversation: moveConversationInDb,
  deleteConversation: deleteConversationInDb,
};

function buildGuestPreviewMessage(): ChatMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content: `### Sign In for Live Gemini AI Chat

Your message was recorded in your **local guest workspace**.

Guest mode runs offline in your browser and does not send requests to Gemini or sync to the cloud. Sign in with a Klyvo account to unlock live streaming Gemini responses and synced chat history.`,
    createdAt: new Date(Date.now() + 250).toISOString(),
    status: 'phase-notice',
  };
}

function buildValidHistoryTurns(
  messages: ChatMessage[],
  options?: {
    upToMessageId?: string;
    stopBeforeMessageId?: string;
    includeMessageId?: string;
  },
): ChatApiTurn[] {
  const turns: ChatApiTurn[] = [];

  for (const msg of messages) {
    if (options?.stopBeforeMessageId && msg.id === options.stopBeforeMessageId) {
      break;
    }

    const isExplicitlyIncluded =
      Boolean(options?.includeMessageId) && msg.id === options?.includeMessageId;

    if (
      (msg.role === 'user' || msg.role === 'assistant') &&
      (msg.status === 'complete' || isExplicitlyIncluded) &&
      !msg.wasAborted &&
      msg.content.trim().length > 0
    ) {
      turns.push({
        role: msg.role,
        content: msg.content.trim(),
      });
    }

    if (options?.upToMessageId && msg.id === options.upToMessageId) {
      break;
    }
  }

  return turns;
}

function sortConversationsDesc(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sortFoldersAsc(items: Folder[]): Folder[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const [activeRoute, setActiveRoute] = useState<WorkspaceRoute>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState<boolean>(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [messageLoadStates, setMessageLoadStates] =
    useState<ConversationMessagesSnapshot>({});
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>(() =>
    storageService.get<UserProfile>('userProfile', DEFAULT_USER_PROFILE),
  );
  const [settings, setSettings] = useState<AppSettings>(() =>
    storageService.get<AppSettings>('settings', DEFAULT_SETTINGS),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isVoiceModalOpen, setVoiceModalOpen] = useState(false);
  const [isAuthPreviewOpen, setAuthPreviewOpen] = useState(false);
  const [latestChatDiagnostics, setLatestChatDiagnostics] =
    useState<ChatDiagnosticsSummary | null>(null);

  const clearLatestChatDiagnostics = useCallback(() => {
    setLatestChatDiagnostics(null);
  }, []);

  const updateDevChatDiagnostics = useCallback(
    (
      updater:
        | ChatDiagnosticsSummary
        | null
        | ((prev: ChatDiagnosticsSummary | null) => ChatDiagnosticsSummary | null),
    ) => {
      if (!import.meta.env.DEV) return;
      setLatestChatDiagnostics(updater);
    },
    [],
  );

  const activeUserIdRef = useRef<string | null>(userId);
  const authLoadingRef = useRef<boolean>(authLoading);
  const hydratedScopeRef = useRef<string>('pending');
  const hydrationRequestIdRef = useRef<number>(0);

  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  const conversationsRef = useRef<Conversation[]>(conversations);
  const foldersRef = useRef<Folder[]>(folders);

  const syncQueueRef = useRef<ConversationSyncQueue>(new ConversationSyncQueue());
  const messageCacheRef = useRef<ConversationMessageCache>(
    new ConversationMessageCache(),
  );
  const persistedFolderIdsRef = useRef<Set<string>>(new Set());
  const folderQueuesRef = useRef<Map<string, Promise<void>>>(new Map());

  const activeGenerationRef = useRef<{
    controller: AbortController;
    userId: string;
    conversationId: string;
    messageId: string;
  } | null>(null);
  const isSubmittingUserMessageRef = useRef<boolean>(false);

  activeUserIdRef.current = userId;
  authLoadingRef.current = authLoading;
  activeConversationIdRef.current = activeConversationId;
  conversationsRef.current = conversations;
  foldersRef.current = folders;

  const abortActiveGeneration = useCallback((reason: 'user' | 'context-change') => {
    const current = activeGenerationRef.current;
    if (!current) return;

    activeGenerationRef.current = null;
    current.controller.abort();
    setStreamingConversationId(null);

    if (reason === 'user') {
      updateDevChatDiagnostics((prev) =>
        prev && prev.status === 'streaming'
          ? {
              ...prev,
              status: 'aborted',
              totalResponseMs:
                prev.totalResponseMs ?? Math.max(0, Date.now() - Date.parse(prev.startedAt)),
              httpStatus: prev.httpStatus ?? 499,
              errorCategory: 'ABORTED_BY_USER',
            }
          : prev,
      );
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== current.conversationId) return conv;
          const nextMessages: ChatMessage[] = [];
          for (const msg of conv.messages) {
            if (msg.id !== current.messageId) {
              nextMessages.push(msg);
              continue;
            }
            if (msg.content.trim().length > 0) {
              nextMessages.push({
                ...msg,
                status: 'complete',
                wasAborted: true,
                saveStatus: 'unsaved',
              });
            }
          }
          return { ...conv, messages: nextMessages };
        }),
      );
    }
  }, []);

  const resetAsyncTracking = useCallback(() => {
    syncQueueRef.current.reset();
    messageCacheRef.current.reset();
    setMessageLoadStates({});
    persistedFolderIdsRef.current.clear();
    folderQueuesRef.current.clear();
  }, []);

  const enqueueFolderOp = useCallback(
    (folderId: string, op: () => Promise<void>): Promise<void> => {
      const prev = folderQueuesRef.current.get(folderId) ?? Promise.resolve();
      const next = prev.then(op, op);
      folderQueuesRef.current.set(folderId, next);
      void next.finally(() => {
        if (folderQueuesRef.current.get(folderId) === next) {
          folderQueuesRef.current.delete(folderId);
        }
      });
      return next;
    },
    [],
  );

  const ensureConversationMessagesLoaded = useCallback(
    async (
      conversationId: string,
      targetUserId: string,
      options?: { force?: boolean },
    ): Promise<boolean> => {
      return messageCacheRef.current.ensureLoaded({
        userId: targetUserId,
        conversationId,
        force: options?.force,
        fetchMessagesByConversation: getMessagesByConversation,
        isCurrentUser: (uid) =>
          activeUserIdRef.current === uid && hydratedScopeRef.current === uid,
        isDeleted: (cid) =>
          syncQueueRef.current.isConversationDeleted(cid) ||
          !conversationsRef.current.some((conv) => conv.id === cid),
        onLoaded: (rows, mapped) => {
          syncQueueRef.current.seedPersistedMessages(rows.map((row) => row.id));
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === conversationId
                ? {
                    ...conv,
                    messages: mergeLoadedMessages(conv.messages, mapped),
                  }
                : conv,
            ),
          );
        },
        onStateChange: (snapshot) => {
          setMessageLoadStates(snapshot);
        },
      });
    },
    [],
  );

  const loadAuthenticatedWorkspace = useCallback(
    async (targetUserId: string, options?: { preserveActiveId?: boolean }) => {
      const requestId = ++hydrationRequestIdRef.current;
      hydratedScopeRef.current = 'pending';
      setIsWorkspaceLoading(true);
      setWorkspaceError(null);

      if (!options?.preserveActiveId) {
        resetAsyncTracking();
        activeConversationIdRef.current = null;
        setConversations([]);
        setFolders([]);
        setActiveConversationId(null);
        setSearchQuery('');
      } else {
        messageCacheRef.current.reset();
        setMessageLoadStates({});
      }

      try {
        const [folderRows, conversationRows] = await Promise.all([
          getFolders(targetUserId),
          getConversations(targetUserId),
        ]);

        if (
          activeUserIdRef.current !== targetUserId ||
          hydrationRequestIdRef.current !== requestId
        ) {
          return;
        }

        const mappedFolders = folderRows.map(mapFolderRow);
        const mappedConversations = mapConversationMetadataRows(conversationRows);

        persistedFolderIdsRef.current = new Set(mappedFolders.map((f) => f.id));
        syncQueueRef.current.seedPersistedConversations(
          mappedConversations.map((c) => c.id),
        );
        if (options?.preserveActiveId) {
          syncQueueRef.current.replacePersistedMessages([]);
        }

        setFolders(mappedFolders);
        setConversations(mappedConversations);

        const candidateActiveId = options?.preserveActiveId
          ? activeConversationIdRef.current
          : null;
        const validActiveId =
          candidateActiveId &&
          mappedConversations.some((conv) => conv.id === candidateActiveId)
            ? candidateActiveId
            : null;
        activeConversationIdRef.current = validActiveId;
        setActiveConversationId(validActiveId);

        hydratedScopeRef.current = targetUserId;
        setWorkspaceError(null);
        setIsWorkspaceLoading(false);

        if (validActiveId) {
          void ensureConversationMessagesLoaded(validActiveId, targetUserId, {
            force: true,
          });
        }
      } catch (err: unknown) {
        if (
          activeUserIdRef.current !== targetUserId ||
          hydrationRequestIdRef.current !== requestId
        ) {
          return;
        }

        resetAsyncTracking();
        activeConversationIdRef.current = null;
        setFolders([]);
        setConversations([]);
        setActiveConversationId(null);
        hydratedScopeRef.current = targetUserId;
        setWorkspaceError(
          err instanceof Error
            ? err.message
            : 'Unable to load your workspace from Supabase.',
        );
        setIsWorkspaceLoading(false);
      }
    },
    [ensureConversationMessagesLoaded, resetAsyncTracking],
  );

  useEffect(() => {
    abortActiveGeneration('context-change');

    if (authLoading) {
      hydrationRequestIdRef.current += 1;
      hydratedScopeRef.current = 'pending';
      setIsWorkspaceLoading(true);
      return;
    }

    if (!userId) {
      hydrationRequestIdRef.current += 1;
      hydratedScopeRef.current = 'pending';
      resetAsyncTracking();
      setLatestChatDiagnostics(null);
      setWorkspaceError(null);
      setSearchQuery('');

      const guestConversations = storageService.get<Conversation[]>(
        'conversations',
        INITIAL_CONVERSATIONS,
      );
      const guestFolders = storageService.get<Folder[]>('folders', INITIAL_FOLDERS);
      const storedActiveId = storageService.get<string | null>(
        'activeConversationId',
        null,
      );
      const validGuestActiveId =
        storedActiveId && guestConversations.some((conv) => conv.id === storedActiveId)
          ? storedActiveId
          : null;

      activeConversationIdRef.current = validGuestActiveId;
      setConversations(guestConversations);
      setFolders(guestFolders);
      setActiveConversationId(validGuestActiveId);
      hydratedScopeRef.current = 'guest';
      setIsWorkspaceLoading(false);
      return;
    }

    void loadAuthenticatedWorkspace(userId, { preserveActiveId: false });
  }, [
    authLoading,
    userId,
    abortActiveGeneration,
    loadAuthenticatedWorkspace,
    resetAsyncTracking,
  ]);

  const refreshWorkspace = useCallback(async () => {
    const currentUserId = activeUserIdRef.current;
    if (authLoadingRef.current || !currentUserId) return;
    await loadAuthenticatedWorkspace(currentUserId, { preserveActiveId: true });
  }, [loadAuthenticatedWorkspace]);

  // Persist guest conversations, folders, and active selection ONLY in guest mode
  useEffect(() => {
    if (authLoading || userId !== null || hydratedScopeRef.current !== 'guest') {
      return;
    }
    storageService.set('conversations', conversations);
  }, [authLoading, userId, conversations]);

  useEffect(() => {
    if (authLoading || userId !== null || hydratedScopeRef.current !== 'guest') {
      return;
    }
    storageService.set('activeConversationId', activeConversationId);
  }, [authLoading, userId, activeConversationId]);

  useEffect(() => {
    if (authLoading || userId !== null || hydratedScopeRef.current !== 'guest') {
      return;
    }
    storageService.set('folders', folders);
  }, [authLoading, userId, folders]);

  useEffect(() => {
    storageService.set('userProfile', userProfile);
  }, [userProfile]);

  useEffect(() => {
    storageService.set('settings', settings);
  }, [settings]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    window.setTimeout(() => {
      setToastMessage((current) => (current === message ? null : current));
    }, 2800);
  }, []);

  const activeConversation =
    conversations.find((item) => item.id === activeConversationId) || null;

  const activeConversationLoadState =
    userId && activeConversationId
      ? messageLoadStates[activeConversationId] ?? { status: 'idle', error: null }
      : { status: 'idle', error: null };
  const isActiveConversationMessagesLoading =
    Boolean(userId && activeConversationId) &&
    activeConversationLoadState.status === 'loading';
  const activeConversationMessagesError =
    Boolean(userId && activeConversationId) &&
    activeConversationLoadState.status === 'error'
      ? activeConversationLoadState.error ?? 'Unable to load messages.'
      : null;

  useEffect(() => {
    if (
      authLoading ||
      !userId ||
      isWorkspaceLoading ||
      hydratedScopeRef.current !== userId ||
      !activeConversationId
    ) {
      return;
    }

    const currentState = messageCacheRef.current.getState(activeConversationId);
    if (currentState.status === 'idle') {
      void ensureConversationMessagesLoaded(activeConversationId, userId);
    }
  }, [
    authLoading,
    userId,
    isWorkspaceLoading,
    activeConversationId,
    ensureConversationMessagesLoaded,
  ]);

  const selectConversation = useCallback(
    (id: string | null) => {
      activeConversationIdRef.current = id;
      setActiveConversationId(id);
      setActiveRoute('chat');

      const targetUserId = activeUserIdRef.current;
      if (
        id &&
        !authLoadingRef.current &&
        targetUserId &&
        hydratedScopeRef.current === targetUserId
      ) {
        void ensureConversationMessagesLoaded(id, targetUserId);
      }
    },
    [ensureConversationMessagesLoaded],
  );

  const retryLoadActiveConversationMessages = useCallback(() => {
    const currentConvId = activeConversationIdRef.current;
    const targetUserId = activeUserIdRef.current;
    if (
      !currentConvId ||
      !targetUserId ||
      authLoadingRef.current ||
      hydratedScopeRef.current !== targetUserId
    ) {
      return;
    }
    void ensureConversationMessagesLoaded(currentConvId, targetUserId, {
      force: true,
    });
  }, [ensureConversationMessagesLoaded]);

  const startNewChat = useCallback(() => {
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setActiveRoute('chat');
  }, []);

  const persistUserMessageFlow = useCallback(
    async (
      targetUserId: string,
      params: {
        conversationId: string;
        conversationTitle: string;
        conversationFolderId: string | null;
        conversationCreatedAt: string;
        userMessage: ChatMessage;
      },
    ): Promise<boolean> => {
      const {
        conversationId,
        conversationTitle,
        conversationFolderId,
        conversationCreatedAt,
        userMessage,
      } = params;

      try {
        const outcome = await syncQueueRef.current.persistUserMessage({
          targetUserId,
          conversationId,
          conversationTitle,
          conversationFolderId,
          conversationCreatedAt,
          userMessage,
          isCurrentScope: () => activeUserIdRef.current === targetUserId,
          conversationExistsLocally: (cid) =>
            conversationsRef.current.some((conv) => conv.id === cid),
          adapter: CONVERSATION_DB_ADAPTER,
          onSaved: (savedMessage) => {
            setConversations((prev) =>
              prev.map((conv) => {
                if (conv.id !== conversationId) return conv;
                const updatedMessages = conv.messages.map((msg) =>
                  msg.id === userMessage.id
                    ? {
                        ...msg,
                        createdAt: savedMessage.created_at,
                        status: 'complete' as const,
                        saveStatus: 'saved' as const,
                        errorMessage: undefined,
                      }
                    : msg,
                );
                return {
                  ...conv,
                  updatedAt: savedMessage.created_at,
                  messages: updatedMessages,
                };
              }),
            );
          },
        });

        return outcome === 'saved';
      } catch (err: unknown) {
        if (
          activeUserIdRef.current !== targetUserId ||
          syncQueueRef.current.isConversationDeleted(conversationId) ||
          !conversationsRef.current.some((conv) => conv.id === conversationId)
        ) {
          return false;
        }

        const message =
          err instanceof Error ? err.message : 'Unable to save message to Supabase.';

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === userMessage.id
                      ? {
                          ...msg,
                          status: 'error' as const,
                          errorMessage: message,
                        }
                      : msg,
                  ),
                }
              : conv,
          ),
        );
        showToast(message);
        return false;
      }
    },
    [showToast],
  );

  const persistAssistantMessageFlow = useCallback(
    async (
      targetUserId: string,
      conversationId: string,
      assistantMessage: ChatMessage,
    ): Promise<boolean> => {
      if (
        syncQueueRef.current.isMessageInFlight(assistantMessage.id) ||
        syncQueueRef.current.isConversationDeleted(conversationId)
      ) {
        return false;
      }
      if (syncQueueRef.current.isMessagePersisted(assistantMessage.id)) {
        return true;
      }

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? {
                ...conv,
                messages: conv.messages.map((msg) =>
                  msg.id === assistantMessage.id
                    ? {
                        ...msg,
                        saveStatus: 'saving' as const,
                        persistenceError: undefined,
                      }
                    : msg,
                ),
              }
            : conv,
        ),
      );

      try {
        const outcome = await syncQueueRef.current.persistAssistantMessage({
          targetUserId,
          conversationId,
          assistantMessage,
          isCurrentScope: () => activeUserIdRef.current === targetUserId,
          conversationExistsLocally: (cid) =>
            conversationsRef.current.some((conv) => conv.id === cid),
          adapter: CONVERSATION_DB_ADAPTER,
          onSaved: (savedRow) => {
            setConversations((prev) =>
              prev.map((conv) =>
                conv.id === conversationId
                  ? {
                      ...conv,
                      updatedAt: savedRow.created_at,
                      messages: conv.messages.map((msg) =>
                        msg.id === assistantMessage.id
                          ? {
                              ...msg,
                              createdAt: savedRow.created_at,
                              status: 'complete' as const,
                              saveStatus: 'saved' as const,
                              persistenceError: undefined,
                            }
                          : msg,
                      ),
                    }
                  : conv,
              ),
            );
          },
        });

        return outcome === 'saved';
      } catch (err: unknown) {
        if (
          activeUserIdRef.current !== targetUserId ||
          syncQueueRef.current.isConversationDeleted(conversationId) ||
          !conversationsRef.current.some((conv) => conv.id === conversationId)
        ) {
          return false;
        }

        const message =
          err instanceof Error
            ? err.message
            : 'Unable to save assistant response to Supabase.';

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === assistantMessage.id
                      ? {
                          ...msg,
                          saveStatus: 'unsaved' as const,
                          persistenceError: message,
                        }
                      : msg,
                  ),
                }
              : conv,
          ),
        );
        showToast('Response generated, but saving to Supabase failed.');
        return false;
      }
    },
    [showToast],
  );

  const runAssistantGeneration = useCallback(
    async (params: {
      targetUserId: string;
      conversationId: string;
      historyTurns: ChatApiTurn[];
      replaceMessageId?: string;
      waitForUserPersist?: Promise<boolean>;
    }) => {
      const {
        targetUserId,
        conversationId,
        historyTurns,
        replaceMessageId,
        waitForUserPersist,
      } = params;

      if (
        activeUserIdRef.current !== targetUserId ||
        hydratedScopeRef.current !== targetUserId ||
        historyTurns.length === 0
      ) {
        return;
      }

      if (activeGenerationRef.current) {
        abortActiveGeneration('context-change');
      }

      const assistantMessageId = generateId();
      const startedAt = new Date().toISOString();
      const abortController = new AbortController();

      activeGenerationRef.current = {
        controller: abortController,
        userId: targetUserId,
        conversationId,
        messageId: assistantMessageId,
      };
      setStreamingConversationId(conversationId);

      const streamingPlaceholder: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: startedAt,
        status: 'streaming',
      };

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== conversationId) return conv;
          if (replaceMessageId) {
            const exists = conv.messages.some((m) => m.id === replaceMessageId);
            return {
              ...conv,
              messages: exists
                ? conv.messages.map((m) =>
                    m.id === replaceMessageId ? streamingPlaceholder : m,
                  )
                : [...conv.messages, streamingPlaceholder],
            };
          }
          return {
            ...conv,
            messages: [...conv.messages, streamingPlaceholder],
          };
        }),
      );

      let accumulatedText = '';
      const uiStreamStartedMs = Date.now();
      let uiDeltaUpdates = 0;
      let firstUiDeltaMs: number | null = null;
      let capturedModel = 'gemini-3.5-flash-lite';
      let capturedThinkingLevel = 'minimal';
      let capturedApiMode = 'generateContentStream';
      let capturedServerFirstResponseMs: number | null = null;
      let capturedServerFirstTextMs: number | null = null;

      updateDevChatDiagnostics({
        model: capturedModel,
        thinkingLevel: capturedThinkingLevel,
        apiMode: capturedApiMode,
        startedAt,
        status: 'streaming',
        firstServerResponseMs: null,
        firstGeneratedTextMs: null,
        firstVisibleUiTextMs: null,
        totalResponseMs: null,
        deltaCount: 0,
        streamedProgressively: null,
        httpStatus: null,
        errorCategory: null,
      });

      const isStillCurrentGeneration = () =>
        activeUserIdRef.current === targetUserId &&
        activeGenerationRef.current?.messageId === assistantMessageId &&
        !abortController.signal.aborted;

      try {
        const result = await streamGeminiChat({
          messages: historyTurns,
          signal: abortController.signal,
          onEvent: (event) => {
            if (!isStillCurrentGeneration()) return;

            if (event.type === 'meta') {
              capturedModel = event.model;
              capturedThinkingLevel = event.thinkingLevel;
              capturedApiMode = event.apiMode;
              if (capturedServerFirstResponseMs === null) {
                capturedServerFirstResponseMs = Date.now() - uiStreamStartedMs;
              }
              updateDevChatDiagnostics((prev) =>
                prev
                  ? {
                      ...prev,
                      model: capturedModel,
                      thinkingLevel: capturedThinkingLevel,
                      apiMode: capturedApiMode,
                      firstServerResponseMs:
                        prev.firstServerResponseMs ?? capturedServerFirstResponseMs,
                    }
                  : prev,
              );
            } else if (event.type === 'delta') {
              uiDeltaUpdates += 1;
              if (firstUiDeltaMs === null) {
                firstUiDeltaMs = Date.now() - uiStreamStartedMs;
                if (import.meta.env.DEV) {
                  console.info('[klyvo:ui]', {
                    stage: 'first_ui_delta',
                    conversationId,
                    messageId: assistantMessageId,
                    chunkChars: event.text.length,
                    elapsedMs: firstUiDeltaMs,
                  });
                }
                updateDevChatDiagnostics((prev) =>
                  prev
                    ? {
                        ...prev,
                        firstVisibleUiTextMs: firstUiDeltaMs,
                        deltaCount: uiDeltaUpdates,
                      }
                    : prev,
                );
              } else if (uiDeltaUpdates === 2) {
                updateDevChatDiagnostics((prev) =>
                  prev
                    ? {
                        ...prev,
                        deltaCount: uiDeltaUpdates,
                        streamedProgressively: true,
                      }
                    : prev,
                );
              }

              accumulatedText += event.text;
              const nextText = accumulatedText;
              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id === conversationId
                    ? {
                        ...conv,
                        messages: conv.messages.map((msg) =>
                          msg.id === assistantMessageId
                            ? { ...msg, content: nextText }
                            : msg,
                        ),
                      }
                    : conv,
                ),
              );
            } else if (event.type === 'done') {
              if (event.serverFirstTextMs !== undefined && event.serverFirstTextMs !== null) {
                capturedServerFirstTextMs = event.serverFirstTextMs;
              }
            }
          },
        });

        if (!isStillCurrentGeneration() || result.aborted) {
          return;
        }

        const uiCompletedMs = Date.now() - uiStreamStartedMs;
        const resolvedServerResponseMs =
          result.firstServerResponseMs ?? capturedServerFirstResponseMs;
        const resolvedFirstTextMs =
          result.serverFirstTextMs ??
          capturedServerFirstTextMs ??
          result.firstClientDeltaMs ??
          firstUiDeltaMs;
        const resolvedProgressive =
          result.progressive ?? (uiDeltaUpdates > 1);

        updateDevChatDiagnostics({
          model: result.model || capturedModel,
          thinkingLevel: result.thinkingLevel || capturedThinkingLevel,
          apiMode: result.apiMode || capturedApiMode,
          startedAt,
          status: 'completed',
          firstServerResponseMs: resolvedServerResponseMs ?? null,
          firstGeneratedTextMs: resolvedFirstTextMs ?? null,
          firstVisibleUiTextMs: firstUiDeltaMs,
          totalResponseMs: result.totalMs ?? uiCompletedMs,
          deltaCount: result.deltaCount ?? uiDeltaUpdates,
          streamedProgressively: resolvedProgressive,
          httpStatus: 200,
          errorCategory: null,
        });

        if (import.meta.env.DEV) {
          console.info('[klyvo:ui]', {
            stage: 'ui_stream_completed',
            conversationId,
            messageId: assistantMessageId,
            uiDeltaUpdates,
            totalChars: accumulatedText.length,
            firstUiDeltaMs,
            firstDeltaToCompleteMs:
              firstUiDeltaMs === null ? null : uiCompletedMs - firstUiDeltaMs,
            elapsedMs: uiCompletedMs,
          });
        }

        activeGenerationRef.current = null;
        setStreamingConversationId(null);

        const finalText = accumulatedText.trim();
        if (!finalText) {
          throw new ChatApiError(
            'Gemini completed without returning any text content.',
            502,
            'EMPTY_RESPONSE',
          );
        }

        const completedMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: accumulatedText,
          createdAt: new Date().toISOString(),
          status: 'complete',
          saveStatus: 'saving',
        };

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === assistantMessageId ? completedMessage : msg,
                  ),
                }
              : conv,
          ),
        );

        const userPersisted = waitForUserPersist ? await waitForUserPersist : true;
        if (!userPersisted || activeUserIdRef.current !== targetUserId) {
          if (activeUserIdRef.current === targetUserId && !userPersisted) {
            setConversations((prev) =>
              prev.map((conv) =>
                conv.id === conversationId
                  ? {
                      ...conv,
                      messages: conv.messages.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              saveStatus: 'unsaved' as const,
                              persistenceError:
                                'Save your message first, then retry saving this response.',
                            }
                          : msg,
                      ),
                    }
                  : conv,
              ),
            );
          }
          return;
        }

        await persistAssistantMessageFlow(
          targetUserId,
          conversationId,
          completedMessage,
        );
      } catch (err: unknown) {
        if (activeGenerationRef.current?.messageId === assistantMessageId) {
          activeGenerationRef.current = null;
          setStreamingConversationId(null);
        }

        if (
          activeUserIdRef.current !== targetUserId ||
          abortController.signal.aborted
        ) {
          return;
        }

        const errorMessage =
          err instanceof Error
            ? err.message
            : 'Unable to generate a Gemini response right now.';
        const errorHttpStatus =
          err instanceof ChatApiError ? err.status : null;
        const errorCategory =
          err instanceof ChatApiError
            ? err.category
            : err instanceof Error
              ? err.name
              : 'UNKNOWN_ERROR';
        const errorElapsedMs = Date.now() - uiStreamStartedMs;

        updateDevChatDiagnostics((prev) => ({
          model: prev?.model || capturedModel,
          thinkingLevel: prev?.thinkingLevel || capturedThinkingLevel,
          apiMode: prev?.apiMode || capturedApiMode,
          startedAt,
          status: 'error',
          firstServerResponseMs:
            prev?.firstServerResponseMs ?? capturedServerFirstResponseMs,
          firstGeneratedTextMs: prev?.firstGeneratedTextMs ?? capturedServerFirstTextMs,
          firstVisibleUiTextMs: prev?.firstVisibleUiTextMs ?? firstUiDeltaMs,
          totalResponseMs: errorElapsedMs,
          deltaCount: uiDeltaUpdates,
          streamedProgressively: uiDeltaUpdates > 1 ? true : false,
          httpStatus: errorHttpStatus ?? prev?.httpStatus ?? null,
          errorCategory,
        }));

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          status: 'error' as const,
                          saveStatus: undefined,
                          errorMessage,
                        }
                      : msg,
                  ),
                }
              : conv,
          ),
        );
        showToast(errorMessage);
      }
    },
    [abortActiveGeneration, persistAssistantMessageFlow, showToast],
  );

  const stopGeneration = useCallback(() => {
    if (!activeGenerationRef.current) return;
    abortActiveGeneration('user');
    showToast('Response generation stopped');
  }, [abortActiveGeneration, showToast]);

  const sendUserMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const timestamp = new Date().toISOString();
      const targetUserId = activeUserIdRef.current;
      const isAuthenticated =
        !authLoadingRef.current &&
        targetUserId !== null &&
        hydratedScopeRef.current === targetUserId;

      if (authLoadingRef.current) {
        showToast('Restoring your session. Please try again in a moment.');
        return;
      }

      if (isAuthenticated && (activeGenerationRef.current || isSubmittingUserMessageRef.current)) {
        showToast('Please wait or stop the current response before sending another message.');
        return;
      }

      if (isAuthenticated) {
        isSubmittingUserMessageRef.current = true;
      }

      try {
        const userMessage: ChatMessage = {
          id: generateId(),
          role: 'user',
          content: trimmed,
          createdAt: timestamp,
          status: isAuthenticated ? 'sending' : 'complete',
        };

        const existingConvId = activeConversationIdRef.current;
        const existingConv = existingConvId
          ? conversationsRef.current.find((conv) => conv.id === existingConvId) ?? null
          : null;

        if (!isAuthenticated) {
          const noticeMessage = buildGuestPreviewMessage();

          if (existingConv) {
            setConversations((prev) =>
              prev.map((conv) =>
                conv.id === existingConv.id
                  ? {
                      ...conv,
                      updatedAt: timestamp,
                      messages: [...conv.messages, userMessage, noticeMessage],
                    }
                  : conv,
              ),
            );
          } else {
            const title =
              trimmed.length > 48 ? `${trimmed.slice(0, 48).trim()}...` : trimmed;
            const newConv: Conversation = {
              id: generateId(),
              title,
              folderId: null,
              createdAt: timestamp,
              updatedAt: timestamp,
              messages: [userMessage, noticeMessage],
            };
            activeConversationIdRef.current = newConv.id;
            setConversations((prev) => [newConv, ...prev]);
            setActiveConversationId(newConv.id);
          }
          setActiveRoute('chat');
          return;
        }

        // Authenticated mode: ensure existing conversation messages are loaded before sending
        let resolvedExistingConv = existingConv;
        if (resolvedExistingConv) {
          const loadStatus = messageCacheRef.current.getState(
            resolvedExistingConv.id,
          ).status;
          if (loadStatus === 'idle' || loadStatus === 'loading') {
            const loadedOk = await ensureConversationMessagesLoaded(
              resolvedExistingConv.id,
              targetUserId,
            );
            if (!loadedOk || activeUserIdRef.current !== targetUserId) {
              if (activeUserIdRef.current === targetUserId) {
                showToast(
                  'Unable to load conversation messages. Please retry before sending.',
                );
              }
              return;
            }
            resolvedExistingConv =
              conversationsRef.current.find(
                (conv) => conv.id === resolvedExistingConv!.id,
              ) ?? null;
          } else if (loadStatus === 'error') {
            showToast(
              'Conversation messages failed to load. Retry loading before sending.',
            );
            return;
          }
        }

        // Update UI immediately and lock activeConversationIdRef synchronously
        let targetConvId: string;
        let targetTitle: string;
        let targetFolderId: string | null;
        let targetCreatedAt: string;

        if (resolvedExistingConv) {
          targetConvId = resolvedExistingConv.id;
          targetTitle = resolvedExistingConv.title;
          targetFolderId = resolvedExistingConv.folderId;
          targetCreatedAt = resolvedExistingConv.createdAt;

          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === targetConvId
                ? {
                    ...conv,
                    updatedAt: timestamp,
                    messages: [...conv.messages, userMessage],
                  }
                : conv,
            ),
          );
        } else {
          targetConvId = generateId();
          targetTitle =
            trimmed.length > 48 ? `${trimmed.slice(0, 48).trim()}...` : trimmed;
          targetFolderId = null;
          targetCreatedAt = timestamp;

          const newConv: Conversation = {
            id: targetConvId,
            title: targetTitle,
            folderId: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            messages: [userMessage],
          };
          messageCacheRef.current.markConversationLoaded(targetConvId);
          setMessageLoadStates(messageCacheRef.current.getSnapshot());
          activeConversationIdRef.current = targetConvId;
          setConversations((prev) => [newConv, ...prev]);
          setActiveConversationId(targetConvId);
        }

        setActiveRoute('chat');

        const historyTurns = resolvedExistingConv
          ? buildValidHistoryTurns([...resolvedExistingConv.messages, userMessage], {
              upToMessageId: userMessage.id,
              includeMessageId: userMessage.id,
            })
          : [{ role: 'user' as const, content: userMessage.content }];

        const userPersistPromise = persistUserMessageFlow(targetUserId, {
          conversationId: targetConvId,
          conversationTitle: targetTitle,
          conversationFolderId: targetFolderId,
          conversationCreatedAt: targetCreatedAt,
          userMessage,
        });

        isSubmittingUserMessageRef.current = false;
        await runAssistantGeneration({
          targetUserId,
          conversationId: targetConvId,
          historyTurns,
          waitForUserPersist: userPersistPromise,
        });
      } finally {
        isSubmittingUserMessageRef.current = false;
      }
    },
    [
      ensureConversationMessagesLoaded,
      persistUserMessageFlow,
      runAssistantGeneration,
      showToast,
    ],
  );

  const retrySaveMessage = useCallback(
    (conversationId: string, messageId: string) => {
      const targetUserId = activeUserIdRef.current;
      if (!targetUserId || hydratedScopeRef.current !== targetUserId) return;

      const targetConv = conversationsRef.current.find((c) => c.id === conversationId);
      const targetMsg = targetConv?.messages.find((m) => m.id === messageId);

      if (
        !targetConv ||
        !targetMsg ||
        targetMsg.role !== 'assistant' ||
        targetMsg.status !== 'complete' ||
        targetMsg.wasAborted ||
        targetMsg.saveStatus !== 'unsaved'
      ) {
        return;
      }

      void persistAssistantMessageFlow(targetUserId, conversationId, targetMsg);
    },
    [persistAssistantMessageFlow],
  );

  const retryNoticeMessage = useCallback(
    (conversationId: string, messageId: string) => {
      const targetConv = conversationsRef.current.find((c) => c.id === conversationId);
      const targetMsg = targetConv?.messages.find((m) => m.id === messageId);
      if (!targetConv || !targetMsg) return;

      const targetUserId = activeUserIdRef.current;
      const isAuthenticated =
        !authLoadingRef.current &&
        targetUserId !== null &&
        hydratedScopeRef.current === targetUserId;

      if (targetMsg.role === 'user' && targetMsg.status === 'error') {
        if (!targetUserId) return;
        if (syncQueueRef.current.isMessageInFlight(messageId)) return;

        const retriedMessage: ChatMessage = {
          ...targetMsg,
          status: 'sending',
          errorMessage: undefined,
        };

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId ? retriedMessage : msg,
                  ),
                }
              : conv,
          ),
        );

        void persistUserMessageFlow(targetUserId, {
          conversationId: targetConv.id,
          conversationTitle: targetConv.title,
          conversationFolderId: targetConv.folderId,
          conversationCreatedAt: targetConv.createdAt,
          userMessage: retriedMessage,
        }).then((savedOk) => {
          if (!savedOk || activeUserIdRef.current !== targetUserId) return;
          const latestConv = conversationsRef.current.find(
            (c) => c.id === conversationId,
          );
          if (!latestConv) return;
          const idx = latestConv.messages.findIndex((m) => m.id === messageId);
          const isLastMessage = idx !== -1 && idx === latestConv.messages.length - 1;
          if (!isLastMessage) return;

          const historyTurns = buildValidHistoryTurns(latestConv.messages, {
            upToMessageId: messageId,
            includeMessageId: messageId,
          });
          void runAssistantGeneration({
            targetUserId,
            conversationId,
            historyTurns,
          });
        });
        return;
      }

      if (
        isAuthenticated &&
        targetMsg.role === 'assistant' &&
        (targetMsg.status === 'error' || targetMsg.wasAborted)
      ) {
        if (activeGenerationRef.current) {
          showToast('Wait for or stop the active generation before retrying.');
          return;
        }

        const historyTurns = buildValidHistoryTurns(targetConv.messages, {
          stopBeforeMessageId: targetMsg.id,
        });

        const lastTurn = historyTurns[historyTurns.length - 1];
        if (lastTurn && lastTurn.role === 'user') {
          void runAssistantGeneration({
            targetUserId,
            conversationId,
            historyTurns,
            replaceMessageId: targetMsg.id,
          });
          return;
        }
      }

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? {
                ...conv,
                messages: conv.messages.filter((msg) => msg.id !== messageId),
              }
            : conv,
        ),
      );
      showToast('Error entry cleared.');
    },
    [persistUserMessageFlow, runAssistantGeneration, showToast],
  );

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const cleaned = title.trim();
      if (!cleaned) return;

      const previous = conversationsRef.current.find((conv) => conv.id === id);
      if (!previous || previous.title === cleaned) return;

      const nextUpdatedAt = new Date().toISOString();
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === id
            ? { ...conv, title: cleaned, updatedAt: nextUpdatedAt }
            : conv,
        ),
      );

      const targetUserId = activeUserIdRef.current;
      if (!targetUserId) {
        showToast('Conversation renamed');
        return;
      }

      void syncQueueRef.current
        .renameConversation({
          targetUserId,
          conversationId: id,
          title: cleaned,
          updatedAt: nextUpdatedAt,
          isCurrentScope: () => activeUserIdRef.current === targetUserId,
          adapter: CONVERSATION_DB_ADAPTER,
          onRenamed: (saved) => {
            setConversations((prev) =>
              prev.map((conv) =>
                conv.id === id
                  ? { ...conv, title: saved.title, updatedAt: saved.updated_at }
                  : conv,
              ),
            );
            showToast('Conversation renamed');
          },
        })
        .catch((err: unknown) => {
          if (
            activeUserIdRef.current !== targetUserId ||
            syncQueueRef.current.isConversationDeleted(id)
          ) {
            return;
          }
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === id
                ? { ...conv, title: previous.title, updatedAt: previous.updatedAt }
                : conv,
            ),
          );
          showToast(err instanceof Error ? err.message : 'Failed to rename conversation.');
        });
    },
    [showToast],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      const previous = conversationsRef.current.find((conv) => conv.id === id);
      if (!previous) return;
      const wasActive = activeConversationIdRef.current === id;

      if (activeGenerationRef.current?.conversationId === id) {
        abortActiveGeneration('context-change');
      }

      const targetUserId = activeUserIdRef.current;
      let hadPersistedOrQueued = false;
      if (targetUserId) {
        ({ hadPersistedOrQueued } = syncQueueRef.current.markDeletedLocally(id));
      }

      messageCacheRef.current.deleteConversation(id);
      setMessageLoadStates(messageCacheRef.current.getSnapshot());
      setConversations((prev) => prev.filter((conv) => conv.id !== id));
      if (wasActive) {
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
      }

      if (!targetUserId) {
        showToast('Conversation deleted');
        return;
      }

      void syncQueueRef.current
        .deleteConversation({
          targetUserId,
          conversationId: id,
          hadPersistedOrQueued,
          isCurrentScope: () => activeUserIdRef.current === targetUserId,
          adapter: CONVERSATION_DB_ADAPTER,
          onDeleted: () => {
            showToast('Conversation deleted');
          },
        })
        .catch((err: unknown) => {
          if (activeUserIdRef.current !== targetUserId) return;
          syncQueueRef.current.restoreAfterFailedDelete(id);
          if (previous.messages.length > 0) {
            messageCacheRef.current.markConversationLoaded(id);
            setMessageLoadStates(messageCacheRef.current.getSnapshot());
          }
          setConversations((prev) => {
            if (prev.some((conv) => conv.id === id)) return prev;
            return sortConversationsDesc([...prev, previous]);
          });
          if (wasActive && activeConversationIdRef.current === null) {
            activeConversationIdRef.current = id;
            setActiveConversationId(id);
          }
          showToast(err instanceof Error ? err.message : 'Failed to delete conversation.');
        });
    },
    [abortActiveGeneration, showToast],
  );

  const moveConversationToFolder = useCallback(
    (conversationId: string, folderId: string | null) => {
      const previous = conversationsRef.current.find((conv) => conv.id === conversationId);
      if (!previous || previous.folderId === folderId) return;

      const nextUpdatedAt = new Date().toISOString();
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? { ...conv, folderId, updatedAt: nextUpdatedAt }
            : conv,
        ),
      );

      const targetUserId = activeUserIdRef.current;
      if (!targetUserId) {
        showToast(folderId ? 'Moved chat to folder' : 'Removed chat from folder');
        return;
      }

      void syncQueueRef.current
        .moveConversation({
          targetUserId,
          conversationId,
          folderId,
          isCurrentScope: () => activeUserIdRef.current === targetUserId,
          ensureFolderReady: async () => {
            if (!folderId) return;
            const pendingFolderOp = folderQueuesRef.current.get(folderId);
            if (pendingFolderOp) {
              await pendingFolderOp;
            }
            if (activeUserIdRef.current !== targetUserId) return;
            if (!persistedFolderIdsRef.current.has(folderId)) {
              throw new Error('Target folder is unavailable.');
            }
          },
          adapter: CONVERSATION_DB_ADAPTER,
          onMoved: (saved) => {
            setConversations((prev) =>
              prev.map((conv) =>
                conv.id === conversationId
                  ? { ...conv, folderId: saved.folder_id, updatedAt: saved.updated_at }
                  : conv,
              ),
            );
            showToast(folderId ? 'Moved chat to folder' : 'Removed chat from folder');
          },
        })
        .catch((err: unknown) => {
          if (
            activeUserIdRef.current !== targetUserId ||
            syncQueueRef.current.isConversationDeleted(conversationId)
          ) {
            return;
          }
          setConversations((prev) =>
            prev.map((conv) =>
              conv.id === conversationId
                ? { ...conv, folderId: previous.folderId, updatedAt: previous.updatedAt }
                : conv,
            ),
          );
          showToast(err instanceof Error ? err.message : 'Failed to move conversation.');
        });
    },
    [showToast],
  );

  const createFolder = useCallback(
    (name: string): Folder | null => {
      const cleaned = name.trim();
      if (!cleaned) return null;

      const timestamp = new Date().toISOString();
      const folder: Folder = {
        id: generateId(),
        name: cleaned,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setFolders((prev) => [...prev, folder]);

      const targetUserId = activeUserIdRef.current;
      if (!targetUserId) {
        showToast(`Folder "${cleaned}" created`);
        return folder;
      }

      void enqueueFolderOp(folder.id, async () => {
        if (activeUserIdRef.current !== targetUserId) return;
        const saved = await createFolderInDb(targetUserId, cleaned, {
          id: folder.id,
          createdAt: timestamp,
        });
        if (activeUserIdRef.current !== targetUserId) return;
        persistedFolderIdsRef.current.add(saved.id);
        setFolders((prev) =>
          prev.map((item) => (item.id === saved.id ? mapFolderRow(saved) : item)),
        );
        showToast(`Folder "${saved.name}" created`);
      }).catch((err: unknown) => {
        if (activeUserIdRef.current !== targetUserId) return;
        setFolders((prev) => prev.filter((item) => item.id !== folder.id));
        showToast(err instanceof Error ? err.message : 'Failed to create folder.');
      });

      return folder;
    },
    [enqueueFolderOp, showToast],
  );

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const cleaned = name.trim();
      if (!cleaned) return;

      const previous = foldersRef.current.find((folder) => folder.id === id);
      if (!previous || previous.name === cleaned) return;

      const nextUpdatedAt = new Date().toISOString();
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === id
            ? { ...folder, name: cleaned, updatedAt: nextUpdatedAt }
            : folder,
        ),
      );

      const targetUserId = activeUserIdRef.current;
      if (!targetUserId) {
        showToast('Folder renamed');
        return;
      }

      void enqueueFolderOp(id, async () => {
        if (activeUserIdRef.current !== targetUserId) return;
        if (!persistedFolderIdsRef.current.has(id)) {
          throw new Error('Folder has not finished saving yet.');
        }
        const saved = await renameFolderInDb(targetUserId, id, cleaned);
        if (activeUserIdRef.current !== targetUserId) return;
        setFolders((prev) =>
          prev.map((folder) => (folder.id === id ? mapFolderRow(saved) : folder)),
        );
        showToast('Folder renamed');
      }).catch((err: unknown) => {
        if (activeUserIdRef.current !== targetUserId) return;
        setFolders((prev) =>
          prev.map((folder) =>
            folder.id === id
              ? { ...folder, name: previous.name, updatedAt: previous.updatedAt }
              : folder,
          ),
        );
        showToast(err instanceof Error ? err.message : 'Failed to rename folder.');
      });
    },
    [enqueueFolderOp, showToast],
  );

  const deleteFolder = useCallback(
    (id: string) => {
      const previous = foldersRef.current.find((folder) => folder.id === id);
      if (!previous) return;

      const affectedConvIds = new Set(
        conversationsRef.current
          .filter((conv) => conv.folderId === id)
          .map((conv) => conv.id),
      );

      setFolders((prev) => prev.filter((folder) => folder.id !== id));
      setConversations((prev) =>
        prev.map((conv) => (conv.folderId === id ? { ...conv, folderId: null } : conv)),
      );

      const targetUserId = activeUserIdRef.current;
      if (!targetUserId) {
        showToast('Folder deleted; chats moved to Recent Chats');
        return;
      }

      if (!persistedFolderIdsRef.current.has(id)) {
        showToast('Folder deleted; chats moved to Recent Chats');
        return;
      }

      void enqueueFolderOp(id, async () => {
        if (activeUserIdRef.current !== targetUserId) return;
        await deleteFolderInDb(targetUserId, id);
        if (activeUserIdRef.current !== targetUserId) return;
        persistedFolderIdsRef.current.delete(id);
        showToast('Folder deleted; chats moved to Recent Chats');
      }).catch((err: unknown) => {
        if (activeUserIdRef.current !== targetUserId) return;
        setFolders((prev) => {
          if (prev.some((folder) => folder.id === id)) return prev;
          return sortFoldersAsc([...prev, previous]);
        });
        setConversations((prev) =>
          prev.map((conv) =>
            affectedConvIds.has(conv.id) && conv.folderId === null
              ? { ...conv, folderId: id }
              : conv,
          ),
        );
        showToast(err instanceof Error ? err.message : 'Failed to delete folder.');
      });
    },
    [enqueueFolderOp, showToast],
  );

  const updateUserProfile = useCallback(
    (updates: Partial<UserProfile>) => {
      setUserProfile((prev) => ({ ...prev, ...updates }));
      showToast('Profile preferences updated');
    },
    [showToast],
  );

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetDemoData = useCallback(() => {
    if (
      authLoadingRef.current ||
      activeUserIdRef.current !== null ||
      hydratedScopeRef.current !== 'guest'
    ) {
      showToast('Demo data reset is available in guest mode only.');
      return;
    }

    storageService.clearWorkspace();
    setConversations(INITIAL_CONVERSATIONS);
    setFolders(INITIAL_FOLDERS);
    setUserProfile(DEFAULT_USER_PROFILE);
    setSettings(DEFAULT_SETTINGS);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setSearchQuery('');
    showToast('Guest workspace reset to defaults');
  }, [showToast]);

  return (
    <WorkspaceContext.Provider
      value={{
        activeRoute,
        setActiveRoute,
        conversations,
        activeConversationId,
        activeConversation,
        isWorkspaceLoading,
        workspaceError,
        isActiveConversationMessagesLoading,
        activeConversationMessagesError,
        retryLoadActiveConversationMessages,
        isAuthenticatedWorkspace: Boolean(userId),
        streamingConversationId,
        isStreamingActive: Boolean(streamingConversationId),
        refreshWorkspace,
        selectConversation,
        startNewChat,
        sendUserMessage,
        stopGeneration,
        retryNoticeMessage,
        retrySaveMessage,
        renameConversation,
        deleteConversation,
        moveConversationToFolder,
        folders,
        createFolder,
        renameFolder,
        deleteFolder,
        searchQuery,
        setSearchQuery,
        userProfile,
        updateUserProfile,
        settings,
        updateSettings,
        resetDemoData,
        toastMessage,
        showToast,
        isVoiceModalOpen,
        setVoiceModalOpen,
        isAuthPreviewOpen,
        setAuthPreviewOpen,
        latestChatDiagnostics,
        clearLatestChatDiagnostics,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
