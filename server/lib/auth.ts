import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface VerifiedAuthUser {
  userId: string;
  email: string | null;
}

export class AuthVerificationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'AuthVerificationError';
    this.status = status;
    this.code = code;
  }
}

interface CachedAuthEntry {
  user: VerifiedAuthUser;
  expiresAtMs: number;
}

const AUTH_CACHE_TTL_MS = 15_000;
const AUTH_CACHE_MAX_ENTRIES = 500;
const verifiedTokenCache = new Map<string, CachedAuthEntry>();

let cachedAuthClient: SupabaseClient | null = null;
let cachedConfigKey = '';

function hashAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

function decodeJwtExpiryMs(accessToken: string): number | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

function getServerSupabaseAuthClient(): SupabaseClient {
  const url = (process.env.SUPABASE_URL || '').trim();
  const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();

  if (!url || !publishableKey) {
    throw new AuthVerificationError(
      'Server authentication is not configured.',
      500,
      'SUPABASE_AUTH_NOT_CONFIGURED',
    );
  }

  const configKey = `${url}::${publishableKey}`;
  if (!cachedAuthClient || cachedConfigKey !== configKey) {
    cachedAuthClient = createClient(url, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedConfigKey = configKey;
    verifiedTokenCache.clear();
  }

  return cachedAuthClient;
}

export function isServerSupabaseAuthConfigured(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || '').trim() &&
      (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
  );
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export async function verifySupabaseRequestAuth(
  request: Request,
): Promise<VerifiedAuthUser> {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    throw new AuthVerificationError(
      'Authentication required. Provide a valid Bearer access token.',
      401,
      'MISSING_ACCESS_TOKEN',
    );
  }

  const cacheKey = hashAccessToken(accessToken);
  const nowMs = Date.now();
  const cached = verifiedTokenCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return cached.user;
    }
    verifiedTokenCache.delete(cacheKey);
  }

  const supabase = getServerSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user?.id) {
    console.warn(
      JSON.stringify({
        scope: 'server/lib/auth',
        stage: 'supabase_get_user_failed',
        status: error?.status ?? null,
        message: error?.message ?? 'missing_user_id',
        timestamp: new Date().toISOString(),
      }),
    );
    throw new AuthVerificationError(
      'Invalid or expired authentication session. Please sign in again.',
      401,
      'INVALID_ACCESS_TOKEN',
    );
  }

  const verifiedUser: VerifiedAuthUser = {
    userId: data.user.id,
    email: data.user.email ?? null,
  };

  const jwtExpiryMs = decodeJwtExpiryMs(accessToken);
  const maxAllowedExpiryMs = nowMs + AUTH_CACHE_TTL_MS;
  const cacheExpiresAtMs =
    jwtExpiryMs !== null
      ? Math.min(maxAllowedExpiryMs, jwtExpiryMs - 1_000)
      : maxAllowedExpiryMs;

  if (cacheExpiresAtMs > nowMs) {
    if (verifiedTokenCache.size >= AUTH_CACHE_MAX_ENTRIES) {
      const oldestKey = verifiedTokenCache.keys().next().value;
      if (oldestKey) verifiedTokenCache.delete(oldestKey);
    }
    verifiedTokenCache.set(cacheKey, {
      user: verifiedUser,
      expiresAtMs: cacheExpiresAtMs,
    });
  }

  return verifiedUser;
}
