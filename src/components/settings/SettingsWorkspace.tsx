import { FormEvent, useEffect, useState } from 'react';
import { Activity, Check, Loader2, LogOut, Monitor, Moon, Pencil, RotateCcw, Sun, X } from 'lucide-react';
import { BRAND_CONFIG } from '../../config/brand';
import { getSupabaseConfigStatus } from '../../config/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { cn } from '../../utils/cn';
import { KlyvoLogo } from '../brand/KlyvoLogo';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { UserAvatar } from '../ui/UserAvatar';

export function SettingsWorkspace() {
  const { theme, setTheme } = useTheme();
  const {
    user,
    profile,
    profileLoading,
    profileError,
    displayName: authDisplayName,
    email: authEmail,
    avatarUrl,
    providerLabel,
    signOut,
    updateDisplayName,
  } = useAuth();
  const {
    settings,
    updateSettings,
    userProfile,
    setAuthPreviewOpen,
    resetDemoData,
    showToast,
    latestChatDiagnostics,
    clearLatestChatDiagnostics,
  } = useWorkspace();

  const [isResetDialogOpen, setResetDialogOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftDisplayName, setDraftDisplayName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameEditError, setNameEditError] = useState<string | null>(null);

  const supabaseStatus = getSupabaseConfigStatus();
  const supabaseConfigured = supabaseStatus.isConfigured;

  useEffect(() => {
    setIsEditingName(false);
    setDraftDisplayName('');
    setIsSavingName(false);
    setNameEditError(null);
  }, [user?.id]);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      showToast(error);
    } else {
      showToast('Signed out');
    }
  };

  const handleStartEditingName = () => {
    setDraftDisplayName(profile?.display_name?.trim() || authDisplayName);
    setNameEditError(null);
    setIsEditingName(true);
  };

  const handleCancelEditingName = () => {
    if (isSavingName) return;
    setIsEditingName(false);
    setNameEditError(null);
  };

  const handleSaveDisplayName = async (e: FormEvent) => {
    e.preventDefault();
    if (isSavingName) return;

    const trimmed = draftDisplayName.trim();
    if (!trimmed) {
      setNameEditError('Display name cannot be empty.');
      return;
    }

    if (profile?.display_name?.trim() === trimmed) {
      setIsEditingName(false);
      setNameEditError(null);
      return;
    }

    setIsSavingName(true);
    setNameEditError(null);
    const { error } = await updateDisplayName(trimmed);
    setIsSavingName(false);

    if (error) {
      setNameEditError(error);
      return;
    }

    setIsEditingName(false);
    showToast('Display name updated');
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#0B1020] dark:text-white">
            Settings
          </h1>
          <p className="mt-1.5 text-sm text-[#4B5563] dark:text-[#94A3B8]">
            Manage appearance, workspace behavior, and integration readiness.
          </p>
        </div>

        {/* Appearance Section */}
        <section className="rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0B1020] dark:text-white">
              Appearance
            </h2>
            <p className="mt-1 text-xs text-[#4B5563] dark:text-[#94A3B8]">
              Switch immediately between Klyvo Deep Ink dark mode and Soft Gray light mode.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setTheme('dark');
                showToast('Switched to Dark Mode');
              }}
              aria-pressed={theme === 'dark'}
              className={cn(
                'flex items-center justify-between p-4 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
                theme === 'dark'
                  ? 'border-[#B8F34A] bg-[#0B1020] text-white'
                  : 'border-[#E5E7EB] dark:border-white/10 hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337]',
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#1B2337] text-[#B8F34A] flex items-center justify-center">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Dark Mode</div>
                  <div className="text-xs opacity-75">Deep Ink (#0B1020)</div>
                </div>
              </div>
              {theme === 'dark' && (
                <span className="text-xs font-semibold text-[#B8F34A]">Active</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme('light');
                showToast('Switched to Light Mode');
              }}
              aria-pressed={theme === 'light'}
              className={cn(
                'flex items-center justify-between p-4 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
                theme === 'light'
                  ? 'border-[#0B1020] bg-[#F3F4F6] text-[#0B1020]'
                  : 'border-[#E5E7EB] dark:border-white/10 hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337]',
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white border border-[#E5E7EB] text-[#0B1020] flex items-center justify-center">
                  <Sun className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Light Mode</div>
                  <div className="text-xs opacity-75">White &amp; Soft Gray</div>
                </div>
              </div>
              {theme === 'light' && (
                <span className="text-xs font-semibold text-[#7C3AED]">Active</span>
              )}
            </button>
          </div>
        </section>

        {/* Workspace Preferences */}
        <section className="rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0B1020] dark:text-white">
              Workspace Preferences
            </h2>
            <p className="mt-1 text-xs text-[#4B5563] dark:text-[#94A3B8]">
              Customize how the chat composer and code blocks behave.
            </p>
          </div>

          <div className="divide-y divide-[#E5E7EB] dark:divide-white/10">
            <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-[#0B1020] dark:text-white">
                  Show code block line numbers
                </div>
                <div className="text-xs text-[#6B7280] dark:text-[#94A3B8]">
                  Displays tabular line numbers beside syntax-highlighted code blocks.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.showCodeLineNumbers}
                onChange={(e) => updateSettings({ showCodeLineNumbers: e.target.checked })}
                className="h-4 w-4 accent-[#7C3AED] dark:accent-[#B8F34A] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#12192E]"
              />
            </label>

            <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-[#0B1020] dark:text-white">
                  Send message with Enter key
                </div>
                <div className="text-xs text-[#6B7280] dark:text-[#94A3B8]">
                  Press Shift + Enter to insert a new line without submitting.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.enterToSend}
                onChange={(e) => updateSettings({ enterToSend: e.target.checked })}
                className="h-4 w-4 accent-[#7C3AED] dark:accent-[#B8F34A] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#12192E]"
              />
            </label>
          </div>
        </section>

        {/* Account & Architecture Readiness */}
        <section className="rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <UserAvatar
                name={user ? authDisplayName : userProfile.displayName}
                avatarUrl={user ? avatarUrl : null}
                size="md"
              />
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-[#0B1020] dark:text-white">
                  Account &amp; Service Readiness
                </h2>
                <p className="mt-0.5 text-xs text-[#4B5563] dark:text-[#94A3B8] truncate">
                  {user
                    ? `Signed in as ${authDisplayName} (${authEmail ?? 'Authenticated'}) · ${providerLabel}`
                    : `Local preview: ${userProfile.displayName} (${userProfile.email})`}
                </p>
              </div>
            </div>

            {user ? (
              <div className="flex items-center gap-2 shrink-0">
                {!isEditingName && (
                  <button
                    type="button"
                    onClick={handleStartEditingName}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E5E7EB] dark:border-white/10 text-xs font-medium text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit Name</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-500/30 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAuthPreviewOpen(true)}
                className="px-3.5 py-2 rounded-lg border border-[#E5E7EB] dark:border-white/10 text-xs font-medium text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                {supabaseConfigured ? 'Sign In / Create Account' : 'Edit Profile Preview'}
              </button>
            )}
          </div>

          {user && (profileLoading || profileError || isEditingName) && (
            <div className="space-y-3">
              {profileLoading && !isEditingName && (
                <div className="flex items-center gap-2 text-xs text-[#6B7280] dark:text-[#94A3B8]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Syncing profile with Supabase...</span>
                </div>
              )}

              {profileError && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                  Profile sync notice: {profileError}
                </div>
              )}

              {isEditingName && (
                <form
                  onSubmit={handleSaveDisplayName}
                  className="rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60 p-3.5 space-y-2.5"
                >
                  <label
                    htmlFor="settings-display-name"
                    className="block text-xs font-semibold text-[#0B1020] dark:text-white"
                  >
                    Display Name
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="settings-display-name"
                      type="text"
                      value={draftDisplayName}
                      onChange={(e) => {
                        setDraftDisplayName(e.target.value);
                        if (nameEditError) setNameEditError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          handleCancelEditingName();
                        }
                      }}
                      disabled={isSavingName}
                      maxLength={80}
                      autoFocus
                      placeholder="Enter your display name"
                      className="flex-1 px-3 py-2 rounded-lg border border-[#E5E7EB] dark:border-white/15 bg-white dark:bg-[#12192E] text-sm text-[#0B1020] dark:text-white placeholder:text-[#9CA3AF] dark:placeholder:text-[#64748B] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/40 dark:focus:ring-[#B8F34A]/40"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="submit"
                        disabled={isSavingName}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0B1020] dark:bg-[#B8F34A] text-white dark:text-[#0B1020] text-xs font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9FAFB] dark:focus-visible:ring-offset-[#0B1020]"
                      >
                        {isSavingName ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>{isSavingName ? 'Saving...' : 'Save'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEditingName}
                        disabled={isSavingName}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#E5E7EB] dark:border-white/10 text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    </div>
                  </div>
                  {nameEditError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{nameEditError}</p>
                  )}
                </form>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
              <div className="font-semibold text-[#0B1020] dark:text-white">
                Supabase Client Config
              </div>
              <div className="mt-1 text-[#4B5563] dark:text-[#94A3B8]">
                {supabaseConfigured
                  ? 'Configured (VITE_SUPABASE_URL & publishable key detected).'
                  : supabaseStatus.hasUrl && !supabaseStatus.hasValidUrl
                    ? 'Invalid VITE_SUPABASE_URL format (expected a valid https:// project URL).'
                    : supabaseStatus.hasValidUrl && !supabaseStatus.hasPublishableKey
                      ? 'VITE_SUPABASE_URL detected, but VITE_SUPABASE_PUBLISHABLE_KEY is missing.'
                      : 'Not configured yet (using local guest storage).'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
              <div className="font-semibold text-[#0B1020] dark:text-white">
                Netlify Serverless Functions
              </div>
              <div className="mt-1 text-[#4B5563] dark:text-[#94A3B8]">
                Structured at <code className="font-mono">netlify/functions/</code> for Gemini
                chat and voice tokens.
              </div>
            </div>
          </div>
        </section>

        {/* Dev-only Chat Diagnostics (Signed-in Users) */}
        {import.meta.env.DEV && user && (
          <section className="rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#F3F4F6] dark:bg-[#1B2337] text-[#7C3AED] dark:text-[#B8F34A] flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-[#0B1020] dark:text-white">
                    Latest Chat Diagnostics (Dev Only)
                  </h2>
                  <p className="mt-0.5 text-xs text-[#4B5563] dark:text-[#94A3B8]">
                    Session-only timing metrics for your most recent signed-in chat request. Contains no tokens or credentials.
                  </p>
                </div>
              </div>

              {latestChatDiagnostics && (
                <button
                  type="button"
                  onClick={clearLatestChatDiagnostics}
                  className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-white/10 text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors self-start sm:self-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                >
                  Clear Metrics
                </button>
              )}
            </div>

            {!latestChatDiagnostics ? (
              <div className="rounded-xl border border-dashed border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/40 px-4 py-4 text-xs text-[#6B7280] dark:text-[#94A3B8]">
                No signed-in chat request recorded in this session yet. Send a message in Chat to measure response latency and progressive SSE streaming.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
                  <div className="text-[#6B7280] dark:text-[#94A3B8]">Selected Gemini Model</div>
                  <div className="mt-1 font-mono font-semibold text-[#0B1020] dark:text-white">
                    {latestChatDiagnostics.model}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6B7280] dark:text-[#94A3B8]">
                    {latestChatDiagnostics.apiMode} · thinking: {latestChatDiagnostics.thinkingLevel}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
                  <div className="text-[#6B7280] dark:text-[#94A3B8]">Request Start Time</div>
                  <div className="mt-1 font-mono font-semibold text-[#0B1020] dark:text-white">
                    {new Date(latestChatDiagnostics.startedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6B7280] dark:text-[#94A3B8]">
                    Status: {latestChatDiagnostics.status}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
                  <div className="text-[#6B7280] dark:text-[#94A3B8]">First Generated Text</div>
                  <div className="mt-1 font-mono font-semibold text-[#0B1020] dark:text-white">
                    {latestChatDiagnostics.firstGeneratedTextMs !== null
                      ? `${latestChatDiagnostics.firstGeneratedTextMs} ms`
                      : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
                  <div className="text-[#6B7280] dark:text-[#94A3B8]">First Visible UI Text</div>
                  <div className="mt-1 font-mono font-semibold text-[#0B1020] dark:text-white">
                    {latestChatDiagnostics.firstVisibleUiTextMs !== null
                      ? `${latestChatDiagnostics.firstVisibleUiTextMs} ms`
                      : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
                  <div className="text-[#6B7280] dark:text-[#94A3B8]">Total Response Time</div>
                  <div className="mt-1 font-mono font-semibold text-[#0B1020] dark:text-white">
                    {latestChatDiagnostics.totalResponseMs !== null
                      ? `${latestChatDiagnostics.totalResponseMs} ms`
                      : 'In progress...'}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60">
                  <div className="text-[#6B7280] dark:text-[#94A3B8]">Progressive Text Chunks</div>
                  <div className="mt-1 font-semibold text-[#0B1020] dark:text-white">
                    {latestChatDiagnostics.streamedProgressively === null
                      ? `Measuring (${latestChatDiagnostics.deltaCount})`
                      : latestChatDiagnostics.streamedProgressively
                        ? `Yes (${latestChatDiagnostics.deltaCount} chunks)`
                        : `${latestChatDiagnostics.deltaCount} chunk`}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60 sm:col-span-2 lg:col-span-3">
                  <div className="text-[#6B7280] dark:text-[#94A3B8]">HTTP Status & Error Category</div>
                  <div
                    className={cn(
                      'mt-1 font-mono font-semibold',
                      latestChatDiagnostics.status === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-[#0B1020] dark:text-white',
                    )}
                  >
                    HTTP {latestChatDiagnostics.httpStatus ?? '—'} · {latestChatDiagnostics.errorCategory ?? 'OK (None)'}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Data Management */}
        <section className="rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0B1020] dark:text-white">
              Local Workspace Data
            </h2>
            <p className="mt-1 text-xs text-[#4B5563] dark:text-[#94A3B8]">
              {user
                ? 'Demo reset applies to guest mode only. Your signed-in chats and folders are stored in Supabase.'
                : 'Restore sample folders and conversations to their default guest state.'}
            </p>
          </div>

          <button
            type="button"
            disabled={Boolean(user)}
            onClick={() => setResetDialogOpen(true)}
            title={
              user
                ? 'Sign out to guest mode to reset local demo data'
                : 'Reset local demo workspace'
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-500/30 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo Data</span>
          </button>
        </section>

        {/* About Klyvo */}
        <section className="rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#12192E] p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <KlyvoLogo size="lg" showAttribution />
            <div className="inline-flex items-center gap-2 text-xs text-[#6B7280] dark:text-[#94A3B8]">
              <Monitor className="w-3.5 h-3.5" />
              <span>{BRAND_CONFIG.phaseLabel}</span>
            </div>
          </div>

          <p className="mt-4 text-sm text-[#4B5563] dark:text-[#CBD5E1] leading-relaxed">
            <strong>{BRAND_CONFIG.appName}</strong> ({BRAND_CONFIG.tagline}) is developed under{' '}
            <strong>{BRAND_CONFIG.parentBrand}</strong>. Built with React, TypeScript, Vite, and
            Tailwind CSS for Netlify serverless deployment and Supabase backend services.
          </p>
        </section>
      </div>

      <ConfirmDialog
        isOpen={isResetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onConfirm={resetDemoData}
        title="Reset local workspace?"
        message="This will clear any local changes to chats and folders and restore the default guest workspace."
        confirmLabel="Reset Workspace"
        destructive
      />
    </div>
  );
}
