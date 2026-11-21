import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  FolderInput,
  FolderMinus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { useDropdownMenu } from '../../hooks/useDropdownMenu';
import { Conversation, Folder } from '../../types';
import { cn } from '../../utils/cn';
import { formatRelativeDate } from '../../utils/formatDate';

interface ChatListItemProps {
  conversation: Conversation;
  isActive: boolean;
  folders: Folder[];
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onMoveToFolder: (folderId: string | null) => void;
}

export function ChatListItem({
  conversation,
  isActive,
  folders,
  onSelect,
  onRename,
  onDelete,
  onMoveToFolder,
}: ChatListItemProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);

  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setDraftTitle(conversation.title);
  }, [conversation.title]);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const commitRename = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    } else {
      setDraftTitle(conversation.title);
    }
    setIsRenaming(false);
  };

  if (isRenaming) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#F3F4F6] dark:bg-[#1B2337]">
        <input
          ref={inputRef}
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              setDraftTitle(conversation.title);
              setIsRenaming(false);
            }
          }}
          aria-label="Rename conversation"
          className="flex-1 min-w-0 bg-transparent text-xs font-medium text-[#0B1020] dark:text-white focus:outline-none"
        />
        <button
          type="button"
          onClick={commitRename}
          aria-label="Confirm rename"
          className="p-1 rounded text-[#0B1020] dark:text-[#B8F34A] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraftTitle(conversation.title);
            setIsRenaming(false);
          }}
          aria-label="Cancel rename"
          className="p-1 rounded text-[#6B7280] dark:text-[#94A3B8] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative group">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full flex items-center gap-2.5 px-2.5 py-2 pr-8 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
          isActive
            ? 'bg-[#F3F4F6] dark:bg-[#1B2337] text-[#0B1020] dark:text-white font-medium'
            : 'text-[#4B5563] dark:text-[#CBD5E1] hover:bg-[#F3F4F6]/80 dark:hover:bg-[#1B2337]/60 hover:text-[#0B1020] dark:hover:text-white',
        )}
      >
        <MessageSquare
          className={cn(
            'w-3.5 h-3.5 shrink-0',
            isActive ? 'text-[#7C3AED] dark:text-[#B8F34A]' : 'text-[#9CA3AF] dark:text-[#64748B]',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] truncate leading-snug">{conversation.title}</div>
          <div className="text-[11px] text-[#6B7280] dark:text-[#64748B] tabular-nums truncate">
            {formatRelativeDate(conversation.updatedAt)}
          </div>
        </div>
      </button>

      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsMenuOpen((prev) => !prev);
        }}
        aria-label={`Actions for ${conversation.title}`}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls={isMenuOpen ? menuId : undefined}
        className={cn(
          'absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[#6B7280] dark:text-[#94A3B8] hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#0B1020] dark:hover:text-white transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
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
          aria-label={`Actions for ${conversation.title}`}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-40 w-48 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#1B2337] shadow-lg py-1.5 text-xs"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              setIsRenaming(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[#0B1020] dark:text-[#F8FAFC] hover:bg-[#F3F4F6] dark:hover:bg-white/5 focus-visible:outline-none focus-visible:bg-[#F3F4F6] dark:focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <Pencil className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#94A3B8]" />
            <span>Rename chat</span>
          </button>

          {folders.length > 0 && (
            <div className="my-1 border-t border-[#E5E7EB] dark:border-white/10 pt-1">
              <div className="px-3 py-1 text-[11px] font-medium text-[#6B7280] dark:text-[#94A3B8]">
                Move to folder
              </div>
              {folders.map((folder) => {
                const isCurrent = conversation.folderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="menuitem"
                    disabled={isCurrent}
                    onClick={() => {
                      setIsMenuOpen(false);
                      onMoveToFolder(folder.id);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[#F3F4F6] dark:hover:bg-white/5 focus-visible:outline-none focus-visible:bg-[#F3F4F6] dark:focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
                      isCurrent
                        ? 'text-[#7C3AED] dark:text-[#B8F34A] font-medium cursor-default'
                        : 'text-[#0B1020] dark:text-[#F8FAFC]',
                    )}
                  >
                    <span className="inline-flex items-center gap-2 truncate">
                      <FolderInput className="w-3.5 h-3.5 shrink-0 opacity-75" />
                      <span className="truncate">{folder.name}</span>
                    </span>
                    {isCurrent && <Check className="w-3 h-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {conversation.folderId && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                onMoveToFolder(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[#0B1020] dark:text-[#F8FAFC] hover:bg-[#F3F4F6] dark:hover:bg-white/5 focus-visible:outline-none focus-visible:bg-[#F3F4F6] dark:focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              <FolderMinus className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#94A3B8]" />
              <span>Remove from folder</span>
            </button>
          )}

          <div className="my-1 border-t border-[#E5E7EB] dark:border-white/10" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 focus-visible:outline-none focus-visible:bg-red-50 dark:focus-visible:bg-red-500/15 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete chat</span>
          </button>
        </div>
      )}
    </div>
  );
}
