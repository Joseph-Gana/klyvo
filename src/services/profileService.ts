import type { User } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';
import type { ProfileRow, UserPreferencesRow } from '../types/database';
import type { ThemeMode } from '../types';

const inFlightProfileEnsure = new Map<string, Promise<ProfileRow | null>>();
const inFlightPrefsEnsure = new Map<string, Promise<UserPreferencesRow | null>>();

function deriveInitialDisplayName(user: User): string | null {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const fullName =
    (typeof metadata?.full_name === 'string' && metadata.full_name.trim()) ||
    (typeof metadata?.name === 'string' && metadata.name.trim()) ||
    '';
  if (fullName) return fullName;
  if (user.email) return user.email.split('@')[0];
  return null;
}

function deriveInitialAvatarUrl(user: User): string | null {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.avatar_url === 'string' && metadata.avatar_url.trim()) {
    return metadata.avatar_url.trim();
  }
  if (typeof metadata?.picture === 'string' && metadata.picture.trim()) {
    return metadata.picture.trim();
  }
  return null;
}

/**
 * Safely retrieves an existing profile row or creates one for legacy accounts
 * created before the on_auth_user_created trigger. Never overwrites existing
 * customized profile fields with OAuth metadata.
 */
export async function ensureUserProfile(user: User): Promise<ProfileRow | null> {
  if (!supabase) return null;

  const existingPromise = inFlightProfileEnsure.get(user.id);
  if (existingPromise) {
    return existingPromise;
  }

  const task = (async (): Promise<ProfileRow | null> => {
    const client = supabase;
    if (!client) return null;

    const { data: existing, error: selectError } = await client
      .from('profiles')
      .select('id, display_name, avatar_url, created_at, updated_at')
      .eq('id', user.id)
      .maybeSingle();

    if (selectError) {
      throw new Error(selectError.message);
    }

    if (existing) {
      return existing;
    }

    const { error: upsertError } = await client.from('profiles').upsert(
      {
        id: user.id,
        display_name: deriveInitialDisplayName(user),
        avatar_url: deriveInitialAvatarUrl(user),
      },
      {
        onConflict: 'id',
        ignoreDuplicates: true,
      },
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    const { data: createdOrExisting, error: refetchError } = await client
      .from('profiles')
      .select('id, display_name, avatar_url, created_at, updated_at')
      .eq('id', user.id)
      .single();

    if (refetchError) {
      throw new Error(refetchError.message);
    }

    return createdOrExisting;
  })();

  inFlightProfileEnsure.set(user.id, task);
  try {
    return await task;
  } finally {
    inFlightProfileEnsure.delete(user.id);
  }
}

export async function updateProfile(
  userId: string,
  updates: { display_name: string | null },
): Promise<ProfileRow> {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }

  const normalizedName = updates.display_name?.trim() || null;

  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: normalizedName })
    .eq('id', userId)
    .select('id, display_name, avatar_url, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getOrCreateUserPreferences(
  userId: string,
  defaultTheme: ThemeMode = 'dark',
): Promise<UserPreferencesRow | null> {
  if (!supabase) return null;

  const existingPromise = inFlightPrefsEnsure.get(userId);
  if (existingPromise) {
    return existingPromise;
  }

  const task = (async (): Promise<UserPreferencesRow | null> => {
    const client = supabase;
    if (!client) return null;

    const { data: existing, error: selectError } = await client
      .from('user_preferences')
      .select('user_id, theme, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (selectError) {
      throw new Error(selectError.message);
    }

    if (existing) {
      return existing;
    }

    const { error: upsertError } = await client.from('user_preferences').upsert(
      {
        user_id: userId,
        theme: defaultTheme,
      },
      {
        onConflict: 'user_id',
        ignoreDuplicates: true,
      },
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    const { data: createdOrExisting, error: refetchError } = await client
      .from('user_preferences')
      .select('user_id, theme, created_at, updated_at')
      .eq('user_id', userId)
      .single();

    if (refetchError) {
      throw new Error(refetchError.message);
    }

    return createdOrExisting;
  })();

  inFlightPrefsEnsure.set(userId, task);
  try {
    return await task;
  } finally {
    inFlightPrefsEnsure.delete(userId);
  }
}

export async function upsertThemePreference(
  userId: string,
  theme: ThemeMode,
): Promise<UserPreferencesRow | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        theme,
      },
      {
        onConflict: 'user_id',
      },
    )
    .select('user_id, theme, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
