import type {
  NextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import type { WebStandardHandler } from '../webAdapter';

export interface BuildCspOptions {
  isDevelopment?: boolean;
  supabaseUrl?: string;
}

export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
};

export const STRICT_API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function normalizeHttpOrigin(rawUrl: string | undefined): string | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(
  options: BuildCspOptions = {},
): string {
  const isDev = Boolean(options.isDevelopment);
  const customSupabaseOrigin = normalizeHttpOrigin(
    options.supabaseUrl ??
      process.env.VITE_SUPABASE_URL ??
      process.env.SUPABASE_URL,
  );
  const customSupabaseWsOrigin = customSupabaseOrigin
    ? customSupabaseOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    : null;

  const scriptSources = isDev
    ? ["'self'", "'unsafe-inline'", 'blob:']
    : ["'self'", 'blob:'];

  const styleSources = isDev
    ? ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']
    : ["'self'", 'https://fonts.googleapis.com'];

  const imgSources = [
    "'self'",
    'data:',
    'https://*.googleusercontent.com',
    'https://*.supabase.co',
  ];
  if (customSupabaseOrigin) {
    imgSources.push(customSupabaseOrigin);
  }

  const connectSources = [
    "'self'",
    'blob:',
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'wss://generativelanguage.googleapis.com',
    'https://generativelanguage.googleapis.com',
  ];
  if (customSupabaseOrigin) {
    connectSources.push(customSupabaseOrigin);
  }
  if (customSupabaseWsOrigin) {
    connectSources.push(customSupabaseWsOrigin);
  }
  if (isDev) {
    connectSources.push('ws:', 'wss:');
  }

  const formActionSources = [
    "'self'",
    'https://*.supabase.co',
    'https://accounts.google.com',
  ];
  if (customSupabaseOrigin) {
    formActionSources.push(customSupabaseOrigin);
  }

  // AI Studio embeds the dev server inside an iframe; production standalone
  // builds deny framing via frame-ancestors 'none' and X-Frame-Options: DENY.
  const frameAncestors = isDev
    ? ["'self'", 'https://aistudio.google.com', 'https://*.googleusercontent.com']
    : ["'none'"];

  return [
    "default-src 'self'",
    `script-src ${Array.from(new Set(scriptSources)).join(' ')}`,
    `style-src ${Array.from(new Set(styleSources)).join(' ')}`,
    "font-src 'self' https://fonts.gstatic.com",
    `img-src ${Array.from(new Set(imgSources)).join(' ')}`,
    `connect-src ${Array.from(new Set(connectSources)).join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${Array.from(new Set(formActionSources)).join(' ')}`,
    `frame-ancestors ${frameAncestors.join(' ')}`,
  ].join('; ');
}

export function getAppSecurityHeaders(
  options: BuildCspOptions = {},
): Record<string, string> {
  const isDev = Boolean(options.isDevelopment);
  const headers: Record<string, string> = {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': buildContentSecurityPolicy(options),
  };

  if (!isDev) {
    headers['X-Frame-Options'] = 'DENY';
  }

  return headers;
}

export function createSecurityHeadersMiddleware(
  options: BuildCspOptions = {},
) {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    const isApiRoute =
      req.path === '/api' || req.path.startsWith('/api/');

    if (isApiRoute) {
      for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
        res.setHeader(key, value);
      }
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', STRICT_API_CSP);
    } else {
      const headers = getAppSecurityHeaders(options);
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
    }

    next();
  };
}

export function applyApiSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', STRICT_API_CSP);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withApiSecurityHeaders(
  handler: WebStandardHandler,
): WebStandardHandler {
  return async (request: Request): Promise<Response> => {
    const response = await handler(request);
    return applyApiSecurityHeaders(response);
  };
}
