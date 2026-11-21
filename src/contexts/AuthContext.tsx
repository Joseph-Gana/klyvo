import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../config/supabase';
import { ensureUserProfile, updateProfile } from '../services/profileService';
import type { ProfileRow } from '../types/database';
import {
  deriveRecoveryStateFromAuthEvent,
  getAuthRedirectOrigin,
  performPasswordRecoveryUpdate,
} from '../utils/authHelpers';

interface AuthActionResult {
  error: string | null;
}

interface SignUpResult extends AuthActionResult {
  requiresEmailConfirmation: boolean;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: ProfileRow | null;
  profileLoading: boolean;
  profileError: string | null;
  loading: boolean;
  isConfigured: boolean;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  providerLabel: string | null;
  isPasswordRecovery: boolean;
  signUp: (params: { email: string; password: string; fullName?: string }) => Promise<SignUpResult>;
  signInWithPassword: (params: { email: string; password: string }) => Promise<AuthActionResult>;
  signInWithGoogle: () => Promise<AuthActionResult>;
  resetPassword: (email: string) => Promise<AuthActionResult>;
  updatePassword: (newPassword: string, confirmPassword?: string) => Promise<AuthActionResult>;
  clearPasswordRecovery: () => void;
  resendConfirmationEmail: (email: string) => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
  updateDisplayName: (name: string) => Promise<AuthActionResult>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function extractDisplayName(user: User | null): string {
  if (!user) return 'Guest';
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const fullName =
    (typeof metadata?.full_name === 'string' && metadata.full_name.trim()) ||
    (typeof metadata?.name === 'string' && metadata.name.trim()) ||
    '';
  if (fullName) return fullName;
  if (user.email) return user.email.split('@')[0];
  return 'Klyvo User';
}

function extractAvatarUrl(user: User | null): string | null {
  if (!user) return null;
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.avatar_url === 'string' && metadata.avatar_url.trim()) {
    return metadata.avatar_url.trim();
  }
  if (typeof metadata?.picture === 'string' && metadata.picture.trim()) {
    return metadata.picture.trim();
  }
  return null;
}

function extractProviderLabel(user: User | null): string | null {
  if (!user) return null;
  const provider = user.app_metadata?.provider;
  if (provider === 'google') return 'Google Account';
  if (provider === 'email') return 'Email & Password';
  return 'Authenticated';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const isConfigured = isSupabaseConfigured() && supabase !== null;
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(isConfigured);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(false);

  const activeUserIdRef = useRef<string | null>(null);
  const latestUserRef = useRef<User | null>(null);

  activeUserIdRef.current = user?.id ?? null;
  latestUserRef.current = user;

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setUser(null);
      setProfile(null);
      setProfileLoading(false);
      setProfileError(null);
      setIsPasswordRecovery(false);
      setLoading(false);
      return;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (!error) {
          setSession(data.session);
          setUser(data.session?.user ?? null);
          if (!data.session) {
            setIsPasswordRecovery(false);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setIsPasswordRecovery((prev) =>
        deriveRecoveryStateFromAuthEvent(event, Boolean(nextSession), prev),
      );
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id ?? null;

  useEffect(() => {
    const currentUser = latestUserRef.current;
    if (!userId || !currentUser || !supabase) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError(null);
      return;
    }

    let cancelled = false;
    setProfile((prev) => (prev?.id === userId ? prev : null));
    setProfileLoading(true);
    setProfileError(null);

    ensureUserProfile(currentUser)
      .then((syncedProfile) => {
        if (cancelled || activeUserIdRef.current !== userId) return;
        setProfile(syncedProfile);
        setProfileLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || activeUserIdRef.current !== userId) return;
        setProfileError(
          err instanceof Error ? err.message : 'Unable to load your saved profile.',
        );
        setProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signUp = useCallback(
    async ({
      email,
      password,
      fullName,
    }: {
      email: string;
      password: string;
      fullName?: string;
    }): Promise<SignUpResult> => {
      if (!supabase) {
        return {
          error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
          requiresEmailConfirmation: false,
        };
      }

      const redirectOrigin = getAuthRedirectOrigin();
      const trimmedName = fullName?.trim();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          ...(redirectOrigin ? { emailRedirectTo: redirectOrigin } : {}),
          data: trimmedName ? { full_name: trimmedName } : undefined,
        },
      });

      if (error) {
        return { error: error.message, requiresEmailConfirmation: false };
      }

      const requiresEmailConfirmation = Boolean(data.user && !data.session);
      return { error: null, requiresEmailConfirmation };
    },
    [],
  );

  const signInWithPassword = useCallback(
    async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }): Promise<AuthActionResult> => {
      if (!supabase) {
        return {
          error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
        };
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      return { error: error ? error.message : null };
    },
    [],
  );

  const signInWithGoogle = useCallback(async (): Promise<AuthActionResult> => {
    if (!supabase) {
      return {
        error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
      };
    }

    const redirectOrigin = getAuthRedirectOrigin();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: redirectOrigin ? { redirectTo: redirectOrigin } : undefined,
    });

    return { error: error ? error.message : null };
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!supabase) {
      return {
        error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
      };
    }

    const redirectOrigin = getAuthRedirectOrigin();
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      redirectOrigin ? { redirectTo: redirectOrigin } : undefined,
    );

    return { error: error ? error.message : null };
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  const updatePassword = useCallback(
    async (
      newPassword: string,
      confirmPassword: string = newPassword,
    ): Promise<AuthActionResult> => {
      if (!supabase) {
        return {
          error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
        };
      }

      return performPasswordRecoveryUpdate({
        newPassword,
        confirmPassword,
        updateUser: (attrs) => supabase!.auth.updateUser(attrs),
        onSuccessClearRecovery: () => {
          setIsPasswordRecovery(false);
          if (
            typeof window !== 'undefined' &&
            window.location?.hash &&
            (window.location.hash.includes('type=recovery') ||
              window.location.hash.includes('access_token='))
          ) {
            window.history.replaceState(
              null,
              '',
              `${window.location.pathname}${window.location.search}`,
            );
          }
        },
      });
    },
    [],
  );

  const resendConfirmationEmail = useCallback(
    async (email: string): Promise<AuthActionResult> => {
      if (!supabase) {
        return {
          error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
        };
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        return { error: 'Please enter your email address first.' };
      }

      const redirectOrigin = getAuthRedirectOrigin();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: trimmedEmail,
        options: redirectOrigin ? { emailRedirectTo: redirectOrigin } : undefined,
      });

      return { error: error ? error.message : null };
    },
    [],
  );

  const signOut = useCallback(async (): Promise<AuthActionResult> => {
    if (!supabase) {
      setIsPasswordRecovery(false);
      return { error: null };
    }

    const { error } = await supabase.auth.signOut();
    if (!error) {
      setIsPasswordRecovery(false);
      setProfile(null);
      setProfileError(null);
      setProfileLoading(false);
    }
    return { error: error ? error.message : null };
  }, []);

  const updateDisplayName = useCallback(
    async (name: string): Promise<AuthActionResult> => {
      const currentUserId = activeUserIdRef.current;
      if (!currentUserId || !supabase) {
        return { error: 'Sign in with a Supabase account to save your display name.' };
      }

      const trimmed = name.trim();
      if (!trimmed) {
        return { error: 'Display name cannot be empty.' };
      }

      try {
        const updatedProfile = await updateProfile(currentUserId, { display_name: trimmed });
        if (activeUserIdRef.current === currentUserId) {
          setProfile(updatedProfile);
          setProfileError(null);
        }
        return { error: null };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Unable to save display name.';
        return { error: message };
      }
    },
    [],
  );

  const resolvedDisplayName = useMemo(() => {
    const savedName = profile?.display_name?.trim();
    if (savedName) return savedName;
    return extractDisplayName(user);
  }, [profile, user]);

  const resolvedAvatarUrl = useMemo(() => {
    const savedAvatar = profile?.avatar_url?.trim();
    if (savedAvatar) return savedAvatar;
    return extractAvatarUrl(user);
  }, [profile, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      profileLoading,
      profileError,
      loading,
      isConfigured,
      displayName: resolvedDisplayName,
      email: user?.email ?? null,
      avatarUrl: resolvedAvatarUrl,
      providerLabel: extractProviderLabel(user),
      isPasswordRecovery,
      signUp,
      signInWithPassword,
      signInWithGoogle,
      resetPassword,
      updatePassword,
      clearPasswordRecovery,
      resendConfirmationEmail,
      signOut,
      updateDisplayName,
    }),
    [
      user,
      session,
      profile,
      profileLoading,
      profileError,
      loading,
      isConfigured,
      resolvedDisplayName,
      resolvedAvatarUrl,
      isPasswordRecovery,
      signUp,
      signInWithPassword,
      signInWithGoogle,
      resetPassword,
      updatePassword,
      clearPasswordRecovery,
      resendConfirmationEmail,
      signOut,
      updateDisplayName,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
