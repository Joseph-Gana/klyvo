import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export interface SupabaseEnvConfig {
  url: string;
  publishableKey: string;
}

export function getSupabaseEnvConfig(): SupabaseEnvConfig {
  return {
    url: (import.meta.env.VITE_SUPABASE_URL || '').trim(),
    publishableKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim(),
  };
}

function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export interface SupabaseConfigStatus {
  hasUrl: boolean;
  hasValidUrl: boolean;
  hasPublishableKey: boolean;
  isConfigured: boolean;
}

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const { url, publishableKey } = getSupabaseEnvConfig();
  const hasUrl = url.length > 0;
  const hasValidUrl = isValidHttpUrl(url);
  const hasPublishableKey = publishableKey.length > 0;
  return {
    hasUrl,
    hasValidUrl,
    hasPublishableKey,
    isConfigured: hasValidUrl && hasPublishableKey,
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfigStatus().isConfigured;
}

let supabaseInstance: SupabaseClient<Database> | null = null;

/**
 * Returns the singleton Supabase client configured with secure default browser
 * auth persistence, or null if VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
 * are not yet configured.
 */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabaseInstance) {
    const { url, publishableKey } = getSupabaseEnvConfig();
    supabaseInstance = createClient<Database>(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabaseInstance;
}

export const supabase: SupabaseClient<Database> | null = getSupabaseClient();
