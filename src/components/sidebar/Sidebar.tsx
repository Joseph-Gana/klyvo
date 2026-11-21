import { useMemo, useState } from 'react';
import {
  Loader2,
  LogIn,
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { Conversation, Folder, WorkspaceRoute } from '../../types';
import { cn } from '../../utils/cn';
import { formatDeleteConversationMessage } from '../../utils/dialogCopy';
import { KlyvoLogo, KlyvoMark } from '../brand/KlyvoLogo';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { UserAvatar } from '../ui/UserAvatar';
import { ChatListItem } from './ChatListItem';
import { FolderSection } from './FolderSection';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onCloseMobile?: () => void;
  isMobile?: boolean;
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  onCloseMobile,
  isMobile = false,
}: SidebarProps) {
  const {
    activeRoute,
    setActiveRoute,
    conversations,
    activeConversationId,
    isWorkspaceLoading,
    workspaceError,
    refreshWorkspace,
    selectConversation,
    startNewChat,
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
    setAuthPreviewOpen,
    showToast,
  } = useWorkspace();

  const {
    user,
    isConfigured: isSupabaseReady,
    displayName: authDisplayName,
    email: authEmail,
    avatarUrl,
    signOut,
  } = useAuth();

  const activeName = user ? authDisplayName : userProfile.displayName;
  const activeSubtitle = user
    ? authEmail || 'Signed in'
    : isSupabaseReady
      ? 'Sign in to sync'
      : userProfile.authModeLabel;

  const handleSignOutClick = async () => {
    const { error } = await signOut();
    if (error) {
      showToast(error);
    } else {
      showToast('Signed out');
      onCloseMobile?.();
    }
  };

  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [chatToDelete, setChatToDelete] = useState<Conversation | null>(null);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) ||
        conv.messages.some((m) => m.content.toLowerCase().includes(query)),
    );
  }, [conversations, searchQuery]);

  const unfiledChats = useMemo(
    () => filteredConversations.filter((conv) => !conv.folderId),
    [filteredConversations],
  );

  const handleNavigate = (route: WorkspaceRoute) => {
    setActiveRoute(route);
    onCloseMobile?.();
  };

  const handleSelectChat = (id: string) => {
    selectConversation(id);
    onCloseMobile?.();
  };

  const handleNewChat = () => {
    startNewChat();
    onCloseMobile?.();
  };

  if (isCollapsed && !isMobile) {
    return (
      <aside
        aria-label="Primary sidebar navigation"
        className="w-[72px] shrink-0 h-full flex flex-col items-center py-4 px-2 border-r border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0E1426] transition-colors"
      >
        <button
          type="button"
          onClick={handleNewChat}
          aria-label="Klyvo home"
          title="Klyvo home"
          className="mb-4 p-1.5 rounded-xl hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
        >
          <KlyvoMark size="md" />
        </button>

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mb-3 w-10 h-10 rounded-xl flex items-center justify-center text-[#4B5563] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] hover:text-[#0B1020] dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleNewChat}
          aria-label="New Chat"
          title="New Chat"
          className="mb-4 w-10 h-10 rounded-xl flex items-center justify-center bg-[#B8F34A] text-[#0B1020] hover:bg-[#a8e636] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1020] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0E1426]"
        >
          <MessageSquarePlus className="w-4 h-4" />
        </button>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-2 pt-3 border-t border-[#E5E7EB] dark:border-white/10">
          <button
            type="button"
            onClick={() => handleNavigate('settings')}
            aria-label="Settings"
            title="Settings"
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
              activeRoute === 'settings'
                ? 'bg-[#F3F4F6] dark:bg-[#1B2337] text-[#7C3AED] dark:text-[#B8F34A]'
                : 'text-[#4B5563] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337]',
            )}
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setAuthPreviewOpen(true)}
            aria-label={user ? 'Account profile' : 'Sign in or account settings'}
            title={activeName}
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:ring-2 hover:ring-[#B8F34A] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <UserAvatar name={activeName} avatarUrl={avatarUrl} size="sm" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Primary sidebar navigation"
      className="w-[280px] shrink-0 h-full flex flex-col border-r border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0E1426] text-[#0B1020] dark:text-[#F8FAFC] transition-colors"
    >
      {/* Top Brand Header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={handleNewChat}
          aria-label="Klyvo home"
          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A] rounded-lg"
        >
          <KlyvoLogo size="md" />
        </button>

        {isMobile ? (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="p-2 rounded-lg text-[#4B5563] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="p-2 rounded-lg text-[#4B5563] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] hover:text-[#0B1020] dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Primary Action & Workspace Routes */}
      <div className="px-3 space-y-2 pb-3 border-b border-[#E5E7EB] dark:border-white/10">
        <button
          type="button"
          onClick={handleNewChat}
          className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1020] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0E1426]"
        >
          <MessageSquarePlus className="w-4 h-4" />
          <span>New Chat</span>
        </button>

        {/* Search Conversations */}
        <div className="relative pt-1">
          <Search className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#94A3B8] absolute left-3 top-[calc(50%+2px)] -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            aria-label="Search conversations"
            className="w-full pl-8 pr-7 py-2 rounded-lg border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#12192E] text-xs text-[#0B1020] dark:text-white placeholder:text-[#6B7280] dark:placeholder:text-[#64748B] focus:outline-none focus:ring-2 focus:ring-[#7C3AED] dark:focus:ring-[#B8F34A]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-[calc(50%+2px)] -translate-y-1/2 p-0.5 rounded text-[#6B7280] hover:text-[#0B1020] dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Folders & Recent Chats */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {isWorkspaceLoading ? (
          <div className="px-2.5 py-6 flex items-center justify-center gap-2 text-xs text-[#6B7280] dark:text-[#94A3B8]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7C3AED] dark:text-[#B8F34A]" />
            <span>Loading workspace...</span>
          </div>
        ) : (
          <>
            {workspaceError && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <p className="leading-relaxed">{workspaceError}</p>
                <button
                  type="button"
                  onClick={() => void refreshWorkspace()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-[#1B2337] border border-amber-300 dark:border-amber-500/30 font-medium text-[#0B1020] dark:text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            <FolderSection
              folders={folders}
              conversations={filteredConversations}
              activeConversationId={activeRoute === 'chat' ? activeConversationId : null}
              searchQuery={searchQuery}
              onSelectConversation={handleSelectChat}
              onCreateFolder={(name) => createFolder(name)}
              onRenameFolder={renameFolder}
              onRequestDeleteFolder={(folder) => setFolderToDelete(folder)}
              onRenameConversation={renameConversation}
              onRequestDeleteConversation={(conv) => setChatToDelete(conv)}
              onMoveConversationToFolder={moveConversationToFolder}
            />

            <section aria-label="Recent Chats">
              <div className="flex items-center justify-between px-2 mb-1.5">
                <h2 className="text-[11px] font-semibold tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
                  Recent Chats
                </h2>
                <span className="text-[11px] text-[#6B7280] dark:text-[#64748B] tabular-nums">
                  {unfiledChats.length}
                </span>
              </div>

              {unfiledChats.length === 0 ? (
                <div className="px-2.5 py-3 rounded-lg border border-dashed border-[#E5E7EB] dark:border-white/10 text-xs text-[#6B7280] dark:text-[#94A3B8]">
                  {searchQuery
                    ? 'No matching conversations found.'
                    : 'Start a new conversation to see your recent chats here.'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {unfiledChats.map((conv) => (
                    <ChatListItem
                      key={conv.id}
                      conversation={conv}
                      isActive={activeRoute === 'chat' && conv.id === activeConversationId}
                      folders={folders}
                      onSelect={() => handleSelectChat(conv.id)}
                      onRename={(title) => renameConversation(conv.id, title)}
                      onDelete={() => setChatToDelete(conv)}
                      onMoveToFolder={(targetFolderId) =>
                        moveConversationToFolder(conv.id, targetFolderId)
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Bottom Settings & Profile Controls */}
      <div className="p-3 border-t border-[#E5E7EB] dark:border-white/10 space-y-1.5">
        <button
          type="button"
          onClick={() => handleNavigate('settings')}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
            activeRoute === 'settings'
              ? 'bg-[#F3F4F6] dark:bg-[#1B2337] text-[#0B1020] dark:text-white font-medium'
              : 'text-[#4B5563] dark:text-[#CBD5E1] hover:bg-[#F3F4F6]/80 dark:hover:bg-[#1B2337]/60',
          )}
        >
          <Settings className="w-4 h-4 text-[#6B7280] dark:text-[#94A3B8]" />
          <span>Settings</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setAuthPreviewOpen(true);
              onCloseMobile?.();
            }}
            className="flex-1 min-w-0 flex items-center gap-3 px-2.5 py-2 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#12192E] hover:border-[#D1D5DB] dark:hover:border-white/20 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <UserAvatar name={activeName} avatarUrl={avatarUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#0B1020] dark:text-white truncate">
                {activeName}
              </div>
              <div className="text-[11px] text-[#6B7280] dark:text-[#94A3B8] truncate">
                {activeSubtitle}
              </div>
            </div>
            {!user && isSupabaseReady && (
              <LogIn className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#B8F34A] shrink-0" />
            )}
          </button>

          {user && (
            <button
              type="button"
              onClick={handleSignOutClick}
              aria-label="Sign out"
              title="Sign out"
              className="h-11 w-10 shrink-0 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#12192E] flex items-center justify-center text-[#4B5563] dark:text-[#94A3B8] hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-500/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={Boolean(folderToDelete)}
        onClose={() => setFolderToDelete(null)}
        onConfirm={() => {
          if (folderToDelete) deleteFolder(folderToDelete.id);
        }}
        title="Delete folder?"
        message={`"${folderToDelete?.name}" will be removed. Any conversations inside it will remain available in Recent Chats.`}
        confirmLabel="Delete Folder"
        destructive
      />

      <ConfirmDialog
        isOpen={Boolean(chatToDelete)}
        onClose={() => setChatToDelete(null)}
        onConfirm={() => {
          if (chatToDelete) deleteConversation(chatToDelete.id);
        }}
        title="Delete conversation?"
        message={formatDeleteConversationMessage(chatToDelete?.title)}
        confirmLabel="Delete Chat"
        destructive
      />
    </aside>
  );
}
