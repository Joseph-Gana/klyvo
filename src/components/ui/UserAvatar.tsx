import { useEffect, useState } from 'react';
import { cn } from '../../utils/cn';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'KL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function UserAvatar({
  name,
  avatarUrl,
  size = 'md',
  className,
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  const sizeClass = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm',
  }[size];

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={cn(
          sizeClass,
          'rounded-lg object-cover shrink-0 border border-[#E5E7EB] dark:border-white/10',
          className,
        )}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        sizeClass,
        'rounded-lg bg-[#0B1020] dark:bg-[#1B2337] text-[#B8F34A] flex items-center justify-center font-bold shrink-0',
        className,
      )}
    >
      {getInitials(name)}
    </div>
  );
}
