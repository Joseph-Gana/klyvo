import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  Mail,
  User as UserIcon,
} from 'lucide-react';
import { BRAND_CONFIG } from '../../config/brand';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  isEmailNotConfirmedError,
  isValidAuthEmail,
  MIN_PASSWORD_LENGTH,
  validateNewPassword,
} from '../../utils/authHelpers';
import { cn } from '../../utils/cn';
import { KlyvoLogo } from '../brand/KlyvoLogo';
import { Modal } from '../ui/Modal';
import { UserAvatar } from '../ui/UserAvatar';

type AuthViewMode = 'signin' | 'signup' | 'forgot-password' | 'reset-password';

interface AuthPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthPreviewModal({ isOpen, onClose }: AuthPreviewModalProps) {
  const {
    user,
    isConfigured,
    isPasswordRecovery,
    displayName,
    email: authEmail,
    avatarUrl,
    providerLabel,
    signUp,
    signInWithPassword,
    signInWithGoogle,
    resetPassword,
    updatePassword,
    clearPasswordRecovery,
    resendConfirmationEmail,
    signOut,
  } = useAuth();
  const { userProfile, updateUserProfile, showToast } = useWorkspace();

  const [view, setView] = useState<AuthViewMode>('signin');
  const [fullName, setFullName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [recoveryCompleted, setRecoveryCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Local preview fields when Supabase env vars are not configured
  const [previewName, setPreviewName] = useState(userProfile.displayName);
  const [previewEmail, setPreviewEmail] = useState(userProfile.email);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setSuccessMessage(null);
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setPendingConfirmationEmail(null);
      setRecoveryCompleted(false);
      setPreviewName(userProfile.displayName);
      setPreviewEmail(userProfile.email);
      if (isPasswordRecovery) {
        setView('reset-password');
      }
    } else {
      setRecoveryCompleted(false);
    }
  }, [isOpen, isPasswordRecovery, userProfile.displayName, userProfile.email]);

  useEffect(() => {
    if (isPasswordRecovery) {
      setView('reset-password');
      setRecoveryCompleted(false);
      setErrorMessage(null);
      setSuccessMessage(null);
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
    }
  }, [isPasswordRecovery]);

  const switchView = (nextView: AuthViewMode) => {
    setView(nextView);
    setErrorMessage(null);
    setSuccessMessage(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setPendingConfirmationEmail(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setPendingConfirmationEmail(null);

    if (!isValidAuthEmail(emailInput)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setSubmitting(true);
    const { error } = await signInWithPassword({ email: emailInput, password });
    setSubmitting(false);

    if (error) {
      setErrorMessage(error);
      if (isEmailNotConfirmedError(error)) {
        setPendingConfirmationEmail(emailInput.trim());
      }
      return;
    }

    showToast('Signed in to Klyvo');
    onClose();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setPendingConfirmationEmail(null);

    if (!fullName.trim()) {
      setErrorMessage('Please enter your name.');
      return;
    }
    if (!isValidAuthEmail(emailInput)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    const passwordValidationError = validateNewPassword(password, confirmPassword);
    if (passwordValidationError) {
      setErrorMessage(passwordValidationError);
      return;
    }

    setSubmitting(true);
    const { error, requiresEmailConfirmation } = await signUp({
      email: emailInput,
      password,
      fullName,
    });
    setSubmitting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    if (requiresEmailConfirmation) {
      const normalizedEmail = emailInput.trim();
      setPendingConfirmationEmail(normalizedEmail);
      setSuccessMessage(
        `Confirmation email sent to ${normalizedEmail}. Please verify your email address before signing in.`,
      );
      setPassword('');
      setConfirmPassword('');
      return;
    }

    showToast('Account created and signed in');
    onClose();
  };

  const handleResendConfirmation = async () => {
    const targetEmail = pendingConfirmationEmail || emailInput.trim();
    if (!isValidAuthEmail(targetEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setErrorMessage(null);
    setResendingConfirmation(true);
    const { error } = await resendConfirmationEmail(targetEmail);
    setResendingConfirmation(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    setSuccessMessage(
      `A new confirmation link has been sent to ${targetEmail}. Please check your inbox.`,
    );
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isValidAuthEmail(emailInput)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    const { error } = await resetPassword(emailInput);
    setSubmitting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    setSuccessMessage(
      `Password reset instructions sent to ${emailInput.trim()}. Check your inbox to continue.`,
    );
  };

  const handleUpdateRecoveredPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const validationError = validateNewPassword(password, confirmPassword);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);
    const { error } = await updatePassword(password, confirmPassword);
    setSubmitting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setRecoveryCompleted(true);
    setSuccessMessage('Your password has been updated. You are signed in and ready to continue.');
    showToast('Password updated');
  };

  const handleExitRecovery = async () => {
    setErrorMessage(null);
    setSubmitting(true);
    const { error } = await signOut();
    setSubmitting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    clearPasswordRecovery();
    setRecoveryCompleted(false);
    setView('signin');
    showToast('Password recovery cancelled');
    onClose();
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setGoogleSubmitting(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setGoogleSubmitting(false);
      setErrorMessage(error);
    }
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    const { error } = await signOut();
    setSubmitting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    showToast('Signed out');
    onClose();
  };

  // Password Recovery View (takes priority over Authenticated Account View while recovering)
  if (isConfigured && (isPasswordRecovery || recoveryCompleted)) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={() => {
          if (recoveryCompleted) {
            setRecoveryCompleted(false);
            clearPasswordRecovery();
          }
          onClose();
        }}
        ariaLabel={recoveryCompleted ? 'Password updated' : 'Set a new password'}
        closeOnEscape={recoveryCompleted && !submitting}
        closeOnBackdrop={recoveryCompleted && !submitting}
        maxWidthClass="max-w-md"
      >
        <div className="flex flex-col items-center text-center mb-5">
          <KlyvoLogo size="lg" showAttribution />
          <p className="mt-2 text-xs font-medium text-[#4B5563] dark:text-[#94A3B8]">
            {BRAND_CONFIG.tagline}
          </p>
        </div>

        <div className="mb-4">
          <h2 className="font-display text-base font-semibold text-[#0B1020] dark:text-white">
            {recoveryCompleted ? 'Password Updated' : 'Set a New Password'}
          </h2>
          <p className="mt-1 text-xs text-[#4B5563] dark:text-[#94A3B8] leading-relaxed">
            {recoveryCompleted
              ? 'Your account credentials have been updated safely.'
              : authEmail
                ? `Choose a new password for ${authEmail}.`
                : 'Choose a new password for your Klyvo account.'}
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30 p-3 text-xs leading-relaxed text-red-800 dark:text-red-200"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-300 dark:border-[#B8F34A]/40 bg-emerald-50 dark:bg-[#B8F34A]/10 p-3 text-xs leading-relaxed text-emerald-900 dark:text-[#E2E8F0]"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-[#B8F34A] shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        {recoveryCompleted ? (
          <button
            type="button"
            onClick={() => {
              setRecoveryCompleted(false);
              clearPasswordRecovery();
              onClose();
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
          >
            Continue to Klyvo
          </button>
        ) : (
          <form onSubmit={handleUpdateRecoveredPassword} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="klyvo-recovery-password"
                className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
              >
                New Password (minimum {MIN_PASSWORD_LENGTH} characters)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="klyvo-recovery-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#B8F34A]"
                  placeholder="Enter a new password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#6B7280] hover:text-[#0B1020] dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="klyvo-recovery-confirm"
                className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="klyvo-recovery-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7C3AED] dark:focus:ring-[#B8F34A]"
                  placeholder="Repeat your new password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1020] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Update Password</span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={handleExitRecovery}
              className="w-full py-2 rounded-lg text-xs font-medium text-[#4B5563] dark:text-[#94A3B8] hover:text-[#0B1020] dark:hover:text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              Cancel &amp; Sign Out
            </button>
          </form>
        )}
      </Modal>
    );
  }

  // Authenticated Account View
  if (user) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        ariaLabel="Klyvo account profile"
        maxWidthClass="max-w-md"
      >
        <div className="flex flex-col items-center text-center mb-6">
          <KlyvoLogo size="lg" showAttribution />
          <p className="mt-2 text-xs font-medium text-[#4B5563] dark:text-[#94A3B8]">
            {BRAND_CONFIG.tagline}
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60 p-4 flex items-center gap-3.5">
          <UserAvatar name={displayName} avatarUrl={avatarUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[#0B1020] dark:text-white truncate">
              {displayName}
            </div>
            {authEmail && (
              <div className="text-xs text-[#4B5563] dark:text-[#94A3B8] truncate">
                {authEmail}
              </div>
            )}
            {providerLabel && (
              <div className="mt-1 text-[11px] font-medium text-[#7C3AED] dark:text-[#B8F34A]">
                {providerLabel}
              </div>
            )}
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[#E5E7EB] dark:border-white/10 text-sm font-medium text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            Close
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4" />
            )}
            <span>Sign Out</span>
          </button>
        </div>
      </Modal>
    );
  }

  // Unconfigured Supabase Fallback (Local Preview Mode Preserved)
  if (!isConfigured) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        ariaLabel="Local workspace profile"
        maxWidthClass="max-w-md"
      >
        <div className="flex flex-col items-center text-center mb-6">
          <KlyvoLogo size="lg" showAttribution />
          <p className="mt-2 text-xs font-medium text-[#4B5563] dark:text-[#94A3B8]">
            {BRAND_CONFIG.tagline}
          </p>
        </div>

        <div className="rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60 p-3.5 mb-5 text-xs leading-relaxed text-[#4B5563] dark:text-[#CBD5E1]">
          <strong>Local Preview Mode:</strong> Add <code className="font-mono">VITE_SUPABASE_URL</code>{' '}
          and <code className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</code> to enable live
          Email/Password and Google Sign-In. You can customize your local workspace profile below.
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateUserProfile({
              displayName: previewName.trim() || 'Workspace Preview',
              email: previewEmail.trim() || 'account@klyscape.com',
            });
            onClose();
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="klyvo-preview-name"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Display Name
            </label>
            <input
              id="klyvo-preview-name"
              type="text"
              value={previewName}
              onChange={(e) => setPreviewName(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#B8F34A]"
              placeholder="Your name"
            />
          </div>

          <div>
            <label
              htmlFor="klyvo-preview-email"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Account Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-preview-email"
                type="email"
                value={previewEmail}
                onChange={(e) => setPreviewEmail(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#B8F34A]"
                placeholder="name@domain.com"
              />
            </div>
          </div>

          <div className="pt-1 flex flex-col gap-2.5">
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
            >
              Save Local Profile
            </button>

            <button
              type="button"
              disabled
              className="w-full py-2.5 px-4 rounded-xl border border-[#E5E7EB] dark:border-white/10 text-sm font-medium text-[#6B7280] dark:text-[#94A3B8] inline-flex items-center justify-center gap-2 opacity-70 cursor-not-allowed"
              title="Configure Supabase environment variables to enable Google Sign-In"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Continue with Google (Requires Supabase Env)</span>
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  // Live Supabase Authentication Views (Sign In / Create Account / Forgot Password)
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={
        view === 'forgot-password'
          ? 'Reset your Klyvo password'
          : view === 'signup'
            ? 'Create a Klyvo account'
            : 'Sign in to Klyvo'
      }
      maxWidthClass="max-w-md"
    >
      <div className="flex flex-col items-center text-center mb-5">
        <KlyvoLogo size="lg" showAttribution />
        <p className="mt-2 text-xs font-medium text-[#4B5563] dark:text-[#94A3B8]">
          {BRAND_CONFIG.tagline}
        </p>
      </div>

      {/* View Switcher (Sign In / Create Account) */}
      {view !== 'forgot-password' && (
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F3F4F6] dark:bg-[#0B1020] mb-5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === 'signin'}
            onClick={() => switchView('signin')}
            className={cn(
              'py-2 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
              view === 'signin'
                ? 'bg-white dark:bg-[#1B2337] text-[#0B1020] dark:text-white shadow-sm'
                : 'text-[#6B7280] dark:text-[#94A3B8] hover:text-[#0B1020] dark:hover:text-white',
            )}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'signup'}
            onClick={() => switchView('signup')}
            className={cn(
              'py-2 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]',
              view === 'signup'
                ? 'bg-white dark:bg-[#1B2337] text-[#0B1020] dark:text-white shadow-sm'
                : 'text-[#6B7280] dark:text-[#94A3B8] hover:text-[#0B1020] dark:hover:text-white',
            )}
          >
            Create Account
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30 p-3 text-xs leading-relaxed text-red-800 dark:text-red-200"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-300 dark:border-[#B8F34A]/40 bg-emerald-50 dark:bg-[#B8F34A]/10 p-3 text-xs leading-relaxed text-emerald-900 dark:text-[#E2E8F0]"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-[#B8F34A] shrink-0 mt-0.5" />
          <span>{successMessage}</span>
        </div>
      )}

      {pendingConfirmationEmail && (view === 'signin' || view === 'signup') && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#0B1020]/60 px-3 py-2.5 text-xs">
          <span className="text-[#4B5563] dark:text-[#CBD5E1]">
            Didn&apos;t receive the verification link?
          </span>
          <button
            type="button"
            disabled={resendingConfirmation || submitting}
            onClick={handleResendConfirmation}
            className="inline-flex items-center gap-1.5 rounded-md px-1 font-semibold text-[#7C3AED] dark:text-[#B8F34A] hover:underline disabled:opacity-60 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            {resendingConfirmation && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{resendingConfirmation ? 'Sending...' : 'Resend email'}</span>
          </button>
        </div>
      )}

      {view === 'signin' && (
        <form onSubmit={handleSignIn} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="klyvo-signin-email"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-signin-email"
                type="email"
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7C3AED] dark:focus:ring-[#B8F34A]"
                placeholder="name@domain.com"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="klyvo-signin-password"
                className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1]"
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => switchView('forgot-password')}
                className="rounded-md px-1 text-xs font-medium text-[#7C3AED] dark:text-[#B8F34A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-signin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7C3AED] dark:focus:ring-[#B8F34A]"
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#6B7280] hover:text-[#0B1020] dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || googleSubmitting}
            className="w-full py-2.5 px-4 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Sign In</span>
          </button>
        </form>
      )}

      {view === 'signup' && (
        <form onSubmit={handleSignUp} noValidate className="space-y-3.5">
          <div>
            <label
              htmlFor="klyvo-signup-name"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Full Name
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-signup-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#B8F34A]"
                placeholder="Your name"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="klyvo-signup-email"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-signup-email"
                type="email"
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#B8F34A]"
                placeholder="name@domain.com"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="klyvo-signup-password"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Password (minimum 6 characters)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-signup-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#B8F34A]"
                placeholder="Create a password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#6B7280] hover:text-[#0B1020] dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="klyvo-signup-confirm"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-signup-confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7C3AED] dark:focus:ring-[#B8F34A]"
                placeholder="Repeat your password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || googleSubmitting}
            className="w-full py-2.5 px-4 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1020] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Create Account</span>
          </button>
        </form>
      )}

      {view === 'forgot-password' && (
        <form onSubmit={handleForgotPassword} noValidate className="space-y-4">
          <div className="text-xs text-[#4B5563] dark:text-[#94A3B8] leading-relaxed">
            Enter your account email and we will send you a link to reset your password.
          </div>

          <div>
            <label
              htmlFor="klyvo-reset-email"
              className="block text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1] mb-1.5"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="klyvo-reset-email"
                type="email"
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#0B1020] text-[#0B1020] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7C3AED] dark:focus:ring-[#B8F34A]"
                placeholder="name@domain.com"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-xl bg-[#B8F34A] text-[#0B1020] text-sm font-semibold hover:bg-[#a8e636] transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1020] dark:focus-visible:ring-[#B8F34A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#12192E]"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Send Reset Link</span>
          </button>

          <button
            type="button"
            onClick={() => switchView('signin')}
            className="w-full py-2 rounded-lg text-xs font-medium text-[#4B5563] dark:text-[#94A3B8] hover:text-[#0B1020] dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
          >
            Back to Sign In
          </button>
        </form>
      )}

      {view !== 'forgot-password' && (
        <>
          <div className="relative my-5 flex items-center">
            <div className="flex-1 border-t border-[#E5E7EB] dark:border-white/10" />
            <span className="px-3 text-[11px] font-medium text-[#6B7280] dark:text-[#94A3B8]">
              or
            </span>
            <div className="flex-1 border-t border-[#E5E7EB] dark:border-white/10" />
          </div>

          <button
            type="button"
            disabled={submitting || googleSubmitting}
            onClick={handleGoogleSignIn}
            className="w-full py-2.5 px-4 rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#1B2337]/60 text-sm font-medium text-[#0B1020] dark:text-white hover:bg-[#F3F4F6] dark:hover:bg-[#1B2337] transition-colors inline-flex items-center justify-center gap-2.5 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
          >
            {googleSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4-3.1Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.76 0 3.34.6 4.58 1.8l3.44-3.44C17.94 1.19 15.23 0 12 0A12 12 0 0 0 1.28 6.6l4 3.1c.95-2.84 3.6-4.95 6.72-4.95Z"
                />
              </svg>
            )}
            <span>Continue with Google</span>
          </button>
        </>
      )}
    </Modal>
  );
}
