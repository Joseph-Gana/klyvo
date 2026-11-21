import { BRAND_CONFIG } from '../../config/brand';
import { cn } from '../../utils/cn';

interface KlyvoLogoProps {
  showWordmark?: boolean;
  showAttribution?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function KlyvoMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dimensions = {
    sm: 'w-7 h-7',
    md: 'w-8 h-8',
    lg: 'w-11 h-11',
  }[size];

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn(dimensions, 'shrink-0', className)}
    >
      <rect width="64" height="64" rx="16" className="fill-[#0B1020] dark:fill-[#1B2337]" />
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14.5"
        className="stroke-black/10 dark:stroke-white/15"
        strokeWidth="2"
      />
      <path d="M19 16V48" stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round" />
      <path
        d="M44 17L26.5 32L44.5 47"
        stroke="#B8F34A"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="44" cy="17" r="3.2" fill="#7C3AED" />
    </svg>
  );
}

export function KlyvoLogo({
  showWordmark = true,
  showAttribution = false,
  size = 'md',
  className,
}: KlyvoLogoProps) {
  const wordmarkSize = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-2xl',
  }[size];

  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <KlyvoMark size={size} />
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              'font-display font-bold tracking-tight text-[#0B1020] dark:text-white whitespace-nowrap',
              wordmarkSize,
            )}
          >
            {BRAND_CONFIG.appName}
          </span>
          {showAttribution && (
            <span className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-[#4B5563] dark:text-[#94A3B8] whitespace-nowrap">
              {BRAND_CONFIG.attributionLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
