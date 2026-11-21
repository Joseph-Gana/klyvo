export const MIN_PASSWORD_LENGTH = 6;

export function isValidAuthEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validateNewPassword(
  password: string,
  confirmPassword: string,
): string | null {
  if (!password) {
    return 'Please enter a new password.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }
  return null;
}

export function getAuthRedirectOrigin(explicitOrigin?: string): string | undefined {
  const candidate =
    explicitOrigin !== undefined
      ? explicitOrigin
      : typeof window !== 'undefined' && window.location
        ? window.location.origin
        : '';

  if (!candidate || candidate === 'null') {
    return undefined;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function isEmailNotConfirmedError(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('email not confirmed') ||
    lower.includes('email_not_confirmed') ||
    lower.includes('confirm your email')
  );
}

export function deriveRecoveryStateFromAuthEvent(
  event: string,
  hasSession: boolean,
  currentRecoveryState: boolean,
): boolean {
  if (event === 'PASSWORD_RECOVERY') {
    return true;
  }
  if (event === 'SIGNED_OUT' || !hasSession) {
    return false;
  }
  return currentRecoveryState;
}

export interface SupabaseUpdateUserResult {
  error: { message: string } | null;
}

export async function performPasswordRecoveryUpdate(params: {
  newPassword: string;
  confirmPassword: string;
  updateUser: (attributes: { password: string }) => Promise<SupabaseUpdateUserResult>;
  onSuccessClearRecovery: () => void;
}): Promise<{ error: string | null }> {
  const validationError = validateNewPassword(
    params.newPassword,
    params.confirmPassword,
  );
  if (validationError) {
    return { error: validationError };
  }

  try {
    const { error } = await params.updateUser({ password: params.newPassword });
    if (error) {
      return { error: error.message };
    }

    params.onSuccessClearRecovery();
    return { error: null };
  } catch (err: unknown) {
    return {
      error:
        err instanceof Error
          ? err.message
          : 'Unable to update your password right now.',
    };
  }
}
