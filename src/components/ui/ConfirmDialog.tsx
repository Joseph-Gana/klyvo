import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidthClass="max-w-md">
      <p className="text-sm leading-relaxed text-[#4B5563] dark:text-[#CBD5E1]">{message}</p>
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-[#E5E7EB] dark:border-white/10 text-[#0B1020] dark:text-[#F8FAFC] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={
            destructive
              ? 'px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]'
              : 'px-4 py-2 text-sm font-semibold rounded-lg bg-[#B8F34A] text-[#0B1020] hover:bg-[#a8e636] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1020] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]'
          }
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
