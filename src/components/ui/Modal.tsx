import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { cn } from '../../utils/cn';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  ariaLabel,
  children,
  maxWidthClass = 'max-w-lg',
  closeOnEscape = true,
  closeOnBackdrop = true,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogPanelRef = useRef<HTMLDivElement>(null);

  useDialogFocus({
    isOpen,
    containerRef: dialogPanelRef,
    onEscape: onClose,
    closeOnEscape,
  });

  if (!isOpen) return null;

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1020]/70 backdrop-blur-[2px]"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogPanelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel || 'Dialog' : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'w-full rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] text-[#0B1020] dark:text-[#F8FAFC] shadow-xl overflow-hidden focus:outline-none',
          maxWidthClass,
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-[#E5E7EB] dark:border-white/10">
            <div>
              {title && (
                <h2 id={titleId} className="font-display text-lg font-semibold">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-[#4B5563] dark:text-[#94A3B8]">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#4B5563] dark:text-[#94A3B8] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] hover:text-[#0B1020] dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body);
  }

  return content;
}
