import { CheckCircle2 } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export function Toast() {
  const { toastMessage } = useWorkspace();

  if (!toastMessage) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-[#E5E7EB] dark:border-white/15 bg-[#0B1020] dark:bg-[#1B2337] text-white shadow-lg text-sm font-medium"
    >
      <CheckCircle2 className="w-4 h-4 text-[#B8F34A] shrink-0" />
      <span>{toastMessage}</span>
    </div>
  );
}
