import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useDropdownMenu } from '../../hooks/useDropdownMenu';
import { Conversation, Folder } from '../../types';
import { cn } from '../../utils/cn';
import { ChatListItem } from './ChatListItem';

interface FolderSectionProps {
  folders: Folder[];
  conversations: Conversation[];
  activeConversationId: string | null;
  searchQuery: string;
  onSelectConversation: (id: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRequestDeleteFolder: (folder: Folder) => void;
  onRenameConversation: (id: string, title: string) => void;
  onRequestDeleteConversation: (conv: Conversation) => void;
  onMoveConversationToFolder: (convId: string, folderId: string | null) => void;
}

interface FolderItemRowProps {
  folder: Folder;
  folderChats: Conversation[];
  isExpanded: boolean;
  activeConversationId: string | null;
  folders: Folder[];
  onToggleExpand: () => void;
  onRenameFolder: (name: string) => void;
  onRequestDeleteFolder: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onRequestDeleteConversation: (conv: Conversation) => void;
  onMoveConversationToFolder: (convId: string, folderId: string | null) => void;
}

function FolderItemRow({
  folder,
  folderChats,
  isExpanded,
  activeConversationId,
  folders,
  onToggleExpand,
  onRenameFolder,
  onRequestDeleteFolder,
  onSelectConversation,
  onRenameConversation,
  onRequestDeleteConversation,
  onMoveConversationToFolder,
}: FolderItemRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(folder.name);

  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  useDropdownMenu({
    isOpen: isMenuOpen,
    onClose: closeMenu,
    containerRef,
    menuRef,
    triggerRef,
  });

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRenameFolder(trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div className="space-y-0.5">
      {isRenaming ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F3F4F6] dark:bg-[#1B2337]">
          <input
            ref={renameInputRef}
            type="text"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            aria-label="Folder name"
            className="flex-1 min-w-0 bg-transparent text-xs font-medium text-[#0B1020] dark:text-white focus:outline-none"
          />
          <button
            type="button"
            onClick={handleRenameSubmit}
            aria-label="Confirm folder rename"
            className="p-1 rounded text-[#0B1020] dark:text-[#B8F34A] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsRenaming(false)}
            aria-label="Cancel folder rename"
            className="p-1 rounded text-[#6B7280] dark:text-[#94A3B8] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="relative group flex items-center">
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={isExpanded}
            className="w-full flex items-center gap-2 px-2 py-1.5 pr-8 rounded-lg text-left text-[13px] font-medium text-[#0B1020] dark:text-[#E2E8F0] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337]/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#94A3B8] shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#94A3B8] shrink-0" />
            )}
            <FolderIcon className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#B8F34A] shrink-0" />
            <span className="truncate flex-1">{folder.name}</span>
            <span className="text-[11px] font-normal text-[#6B7280] dark:text-[#64748B] tabular-nums">
              {folderChats.length}
            </span>
          </button>

          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsMenuOpen((curr) => !curr);
            }}
            aria-label={`Folder options for ${folder.name}`}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            aria-controls={isMenuOpen ? menuId : undefined}
            className={cn(
              'absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#6B7280] dark:text-[#94A3B8] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#0B1020] dark:hover:text-white transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
              isMenuOpen
                ? 'opacity-100 bg-black/5 dark:bg-white/10'
                : 'opacity-75 md:opacity-60 group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {isMenuOpen && (
            <div
              id={menuId}
              ref={menuRef}
              role="menu"
              aria-label={`Folder options for ${folder.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1 z-40 w-40 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#1B2337] shadow-lg py-1 text-xs"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsMenuOpen(false);
                  setRenameDraft(folder.name);
                  setIsRenaming(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-white/5 focus-visible:outline-none focus-visible:bg-[#F3F4F6] dark:focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                <Pencil className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#94A3B8]" />
                <span>Rename folder</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsMenuOpen(false);
                  onRequestDeleteFolder();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 focus-visible:outline-none focus-visible:bg-red-50 dark:focus-visible:bg-red-500/15 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete folder</span>
              </button>
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <div className="pl-4 space-y-0.5">
          {folderChats.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[11px] text-[#6B7280] dark:text-[#64748B]">
              Empty folder
            </div>
          ) : (
            folderChats.map((conv) => (
              <ChatListItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                folders={folders}
                onSelect={() => onSelectConversation(conv.id)}
                onRename={(title) => onRenameConversation(conv.id, title)}
                onDelete={() => onRequestDeleteConversation(conv)}
                onMoveToFolder={(targetFolderId) =>
                  onMoveConversationToFolder(conv.id, targetFolderId)
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function FolderSection({
  folders,
  conversations,
  activeConversationId,
  searchQuery,
  onSelectConversation,
  onCreateFolder,
  onRenameFolder,
  onRequestDeleteFolder,
  onRenameConversation,
  onRequestDeleteConversation,
  onMoveConversationToFolder,
}: FolderSectionProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    folders.forEach((f) => {
      map[f.id] = true;
    });
    return map;
  });
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) newInputRef.current?.focus();
  }, [isCreating]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const handleCreateSubmit = () => {
    const trimmed = newFolderName.trim();
    if (trimmed) {
      onCreateFolder(trimmed);
    }
    setNewFolderName('');
    setIsCreating(false);
  };

  return (
    <section aria-label="Folders">
      <div className="flex items-center justify-between px-2 mb-1.5">
        <h2 className="text-[11px] font-semibold tracking-wide text-[#6B7280] dark:text-[#94A3B8]">
          Folders
        </h2>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          aria-label="Create new folder"
          title="New folder"
          className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium text-[#4B5563] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] hover:text-[#0B1020] dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {isCreating && (
        <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#B8F34A] bg-white dark:bg-[#1B2337]">
          <FolderPlus className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#B8F34A] shrink-0" />
          <input
            ref={newInputRef}
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSubmit();
              if (e.key === 'Escape') {
                setNewFolderName('');
                setIsCreating(false);
              }
            }}
            aria-label="New folder name"
            placeholder="Folder name..."
            className="flex-1 min-w-0 bg-transparent text-xs text-[#0B1020] dark:text-white placeholder:text-[#9CA3AF] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreateSubmit}
            aria-label="Save folder"
            className="p-1 rounded text-[#0B1020] dark:text-[#B8F34A] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setNewFolderName('');
              setIsCreating(false);
            }}
            aria-label="Cancel creating folder"
            className="p-1 rounded text-[#6B7280] dark:text-[#94A3B8] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {folders.length === 0 ? (
        <div className="px-2.5 py-3 rounded-lg border border-dashed border-[#E5E7EB] dark:border-white/10 text-xs text-[#6B7280] dark:text-[#94A3B8]">
          No folders yet. Organize related chats by creating a folder.
        </div>
      ) : (
        <div className="space-y-1">
          {folders.map((folder) => {
            const folderChats = conversations.filter((c) => c.folderId === folder.id);
            const isExpanded = searchQuery ? folderChats.length > 0 : expandedIds[folder.id] ?? true;

            return (
              <FolderItemRow
                key={folder.id}
                folder={folder}
                folderChats={folderChats}
                isExpanded={isExpanded}
                activeConversationId={activeConversationId}
                folders={folders}
                onToggleExpand={() => toggleExpand(folder.id)}
                onRenameFolder={(name) => onRenameFolder(folder.id, name)}
                onRequestDeleteFolder={() => onRequestDeleteFolder(folder)}
                onSelectConversation={onSelectConversation}
                onRenameConversation={onRenameConversation}
                onRequestDeleteConversation={onRequestDeleteConversation}
                onMoveConversationToFolder={onMoveConversationToFolder}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
