import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-2xl border border-dashed border-[#D1D5DB] dark:border-white/15 bg-white/70 dark:bg-[#12192E]/60">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#F3F4F6] dark:bg-[#1B2337] text-[#4B5563] dark:text-[#CBD5E1] mb-4">
        {icon}
      </div>
      <h3 className="font-display text-base font-semibold text-[#0B1020] dark:text-white">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-[#4B5563] dark:text-[#94A3B8] max-w-sm leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 px-4 py-2 text-sm font-semibold rounded-lg bg-[#B8F34A] text-[#0B1020] hover:bg-[#a8e636] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
