import React, { useEffect, useRef, useState } from 'react';
import { Menu, Moon, SquarePen, Sun } from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { AuthPreviewModal } from '../components/modals/AuthPreviewModal';
import { VoicePreviewModal } from '../components/modals/VoicePreviewModal';
import { Sidebar } from '../components/sidebar/Sidebar';
import { Toast } from '../components/ui/Toast';
import { WorkspaceRoute } from '../types';

const ROUTE_TITLES: Record<WorkspaceRoute, string> = {
  chat: 'Chat',
  settings: 'Settings',
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { isPasswordRecovery } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const {
    activeRoute,
    activeConversation,
    startNewChat,
    isVoiceModalOpen,
    setVoiceModalOpen,
    isAuthPreviewOpen,
    setAuthPreviewOpen,
  } = useWorkspace();

  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isDesktopCollapsed, setDesktopCollapsed] = useState(false);
  const [isMobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const mainShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPasswordRecovery) {
      setAuthPreviewOpen(true);
    }
  }, [isPasswordRecovery, setAuthPreviewOpen]);

  useEffect(() => {
    if (isDesktop) {
      setMobileDrawerOpen(false);
    }
  }, [isDesktop]);

  useDialogFocus({
    isOpen: isMobileDrawerOpen && !isDesktop,
    containerRef: mobileDrawerRef,
    restoreFocusToRef: mobileMenuButtonRef,
    backgroundRef: mainShellRef,
    onEscape: () => setMobileDrawerOpen(false),
    closeOnEscape: true,
  });

  const headerTitle =
    activeRoute === 'chat' && activeConversation
      ? activeConversation.title
      : ROUTE_TITLES[activeRoute];

  return (
    <div className="h-dvh w-full flex overflow-hidden bg-[#F3F4F6] dark:bg-[#0B1020] text-[#0B1020] dark:text-[#F8FAFC] transition-colors">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex h-full">
        <Sidebar
          isCollapsed={isDesktopCollapsed}
          onToggleCollapse={() => setDesktopCollapsed((prev) => !prev)}
        />
      </div>

      {/* Mobile Slide-Out Drawer */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-[#0B1020]/60 backdrop-blur-[1px]"
            aria-hidden="true"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div
            id="mobile-navigation-drawer"
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="relative z-10 h-full max-w-[85vw] focus:outline-none"
          >
            <Sidebar
              isCollapsed={false}
              onToggleCollapse={() => setMobileDrawerOpen(false)}
              onCloseMobile={() => setMobileDrawerOpen(false)}
              isMobile
            />
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div ref={mainShellRef} className="flex-1 flex flex-col min-w-0 h-full">
        <header className="h-14 shrink-0 flex items-center justify-between gap-4 px-4 sm:px-6 border-b border-[#E5E7EB] dark:border-white/10 bg-white/85 dark:bg-[#0B1020]/90 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={isMobileDrawerOpen}
              aria-controls="mobile-navigation-drawer"
              className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg text-[#4B5563] dark:text-[#CBD5E1] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span className="font-display text-sm font-semibold text-[#0B1020] dark:text-white truncate">
                {headerTitle}
              </span>
              <span className="hidden sm:inline text-xs text-[#6B7280] dark:text-[#64748B] whitespace-nowrap">
                · {BRAND_CONFIG.appName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {(activeRoute !== 'chat' || activeConversation) && (
              <button
                type="button"
                onClick={startNewChat}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#E5E7EB] dark:border-white/10 text-xs font-medium text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                <SquarePen className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Chat</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-[#E5E7EB] dark:border-white/10 text-[#4B5563] dark:text-[#CBD5E1] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] hover:text-[#0B1020] dark:hover:text-white transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#B8F34A]" />
              ) : (
                <Moon className="w-4 h-4 text-[#0B1020]" />
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
      </div>

      <VoicePreviewModal
        isOpen={isVoiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
      />
      <AuthPreviewModal
        isOpen={isAuthPreviewOpen}
        onClose={() => setAuthPreviewOpen(false)}
      />
      <Toast />
    </div>
  );
}
