import { ArrowUpRight } from 'lucide-react';
import { BRAND_CONFIG } from '../../config/brand';
import { SUGGESTED_PROMPTS } from '../../data/mockData';
import { KlyvoMark } from '../brand/KlyvoLogo';

interface WelcomeScreenProps {
  onSelectPrompt: (prompt: string) => void;
}

export function WelcomeScreen({ onSelectPrompt }: WelcomeScreenProps) {
  return (
    <div className="max-w-3xl mx-auto w-full py-8 sm:py-14 px-4 flex flex-col items-center text-center">
      <div className="mb-5">
        <KlyvoMark size="lg" />
      </div>

      <h1 className="font-display text-2xl sm:text-4xl font-semibold tracking-tight text-[#0B1020] dark:text-white text-balance">
        What can I help you with?
      </h1>

      <p className="mt-3 max-w-xl text-sm sm:text-base text-[#4B5563] dark:text-[#94A3B8] leading-relaxed">
        {BRAND_CONFIG.description}
      </p>

      <div className="mt-8 w-full grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
        {SUGGESTED_PROMPTS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className="group flex flex-col justify-between p-4 rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] hover:border-[#0B1020]/30 dark:hover:border-[#B8F34A]/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-[#0B1020] dark:text-white">
                {item.title}
              </h2>
              <ArrowUpRight className="w-4 h-4 text-[#9CA3AF] dark:text-[#64748B] group-hover:text-[#0B1020] dark:group-hover:text-[#B8F34A] transition-colors shrink-0" />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-[#4B5563] dark:text-[#94A3B8]">
              {item.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
