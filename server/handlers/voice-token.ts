import { randomUUID } from 'node:crypto';
import {
  AuthVerificationError,
  extractBearerToken,
  isServerSupabaseAuthConfigured,
  verifySupabaseRequestAuth,
} from '../lib/auth';
import {
  extractGeminiErrorDiagnostics,
  isGeminiConfigured,
} from '../lib/gemini';
import {
  mapSafeVoiceTokenError,
  mintGeminiLiveEphemeralToken,
} from '../lib/geminiLive';
import { checkUserRateLimit } from '../lib/rateLimit';

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export interface VoiceTokenHandlerDeps {
  extractBearerToken?: typeof extractBearerToken;
  isServerSupabaseAuthConfigured?: typeof isServerSupabaseAuthConfigured;
  isGeminiConfigured?: typeof isGeminiConfigured;
  verifySupabaseRequestAuth?: typeof verifySupabaseRequestAuth;
  checkUserRateLimit?: typeof checkUserRateLimit;
  mintGeminiLiveEphemeralToken?: typeof mintGeminiLiveEphemeralToken;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(extraHeaders ?? {}),
    },
  });
}

function logVoiceTokenStage(
  level: 'info' | 'warn' | 'error',
  stage: string,
  details: Record<string, unknown>,
): void {
  const entry = JSON.stringify({
    scope: 'api/voice-token',
    stage,
    timestamp: new Date().toISOString(),
    ...details,
  });
  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.info(entry);
  }
}

export function createVoiceTokenHandler(deps: VoiceTokenHandlerDeps = {}) {
  const getBearer = deps.extractBearerToken ?? extractBearerToken;
  const checkSupabaseCfg =
    deps.isServerSupabaseAuthConfigured ?? isServerSupabaseAuthConfigured;
  const checkGeminiCfg = deps.isGeminiConfigured ?? isGeminiConfigured;
  const verifyAuth = deps.verifySupabaseRequestAuth ?? verifySupabaseRequestAuth;
  const rateLimitCheck = deps.checkUserRateLimit ?? checkUserRateLimit;
  const mintToken =
    deps.mintGeminiLiveEphemeralToken ?? mintGeminiLiveEphemeralToken;

  return async function handleVoiceToken(
    request: Request,
  ): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          Allow: 'POST, OPTIONS',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse(
        { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' },
        405,
        { Allow: 'POST, OPTIONS' },
      );
    }

    const requestId = randomUUID().slice(0, 8);
    const startedAtMs = Date.now();

    if (!getBearer(request)) {
      logVoiceTokenStage('warn', 'auth_missing_token', {
        requestId,
        status: 401,
      });
      return jsonResponse(
        {
          error: 'Authentication required. Provide a valid Bearer access token.',
          code: 'MISSING_ACCESS_TOKEN',
        },
        401,
      );
    }

    if (!checkSupabaseCfg()) {
      logVoiceTokenStage('error', 'config_supabase_missing', {
        requestId,
        status: 500,
      });
      return jsonResponse(
        {
          error: 'Server authentication is not configured.',
          code: 'SUPABASE_AUTH_NOT_CONFIGURED',
        },
        500,
      );
    }

    if (!checkGeminiCfg()) {
      logVoiceTokenStage('error', 'config_gemini_missing', {
        requestId,
        status: 500,
      });
      return jsonResponse(
        {
          error: 'Gemini voice service is not configured on the server.',
          code: 'GEMINI_NOT_CONFIGURED',
        },
        500,
      );
    }

    let verifiedUserId: string;
    try {
      const verifiedUser = await verifyAuth(request);
      verifiedUserId = verifiedUser.userId;
    } catch (error: unknown) {
      if (error instanceof AuthVerificationError) {
        logVoiceTokenStage('warn', 'auth_rejected', {
          requestId,
          status: error.status,
          code: error.code,
        });
        return jsonResponse(
          { error: error.message, code: error.code },
          error.status,
        );
      }
      logVoiceTokenStage('warn', 'auth_verification_exception', {
        requestId,
        status: 401,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return jsonResponse(
        {
          error: 'Unable to verify authentication session.',
          code: 'AUTH_VERIFICATION_FAILED',
        },
        401,
      );
    }

    // Use a dedicated `voice:` namespace so voice token minting has a separate
    // per-user rate limit bucket from text chat requests.
    const rateLimit = rateLimitCheck(`voice:${verifiedUserId}`);
    if (!rateLimit.allowed) {
      logVoiceTokenStage('warn', 'rate_limited', {
        requestId,
        status: 429,
        userPrefix: verifiedUserId.slice(0, 8),
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
      return jsonResponse(
        {
          error: `Voice token rate limit exceeded (${rateLimit.limit} requests/min per instance). Please wait ${rateLimit.retryAfterSeconds}s and try again.`,
          code: 'RATE_LIMITED',
        },
        429,
        {
          'Retry-After': String(rateLimit.retryAfterSeconds),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
        },
      );
    }

    try {
      const minted = await mintToken({
        signal: request.signal,
      });

      logVoiceTokenStage('info', 'voice_token_minted', {
        requestId,
        status: 200,
        userPrefix: verifiedUserId.slice(0, 8),
        model: minted.model,
        apiVersion: minted.apiVersion,
        elapsedMs: Date.now() - startedAtMs,
      });

      return jsonResponse(
        {
          token: minted.token,
          model: minted.model,
          apiVersion: minted.apiVersion,
          expireTime: minted.expireTime,
          newSessionExpireTime: minted.newSessionExpireTime,
          uses: minted.uses,
        },
        200,
        {
          'X-Klyvo-Request-Id': requestId,
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
        },
      );
    } catch (error: unknown) {
      const diag = extractGeminiErrorDiagnostics(error);
      const mapped = mapSafeVoiceTokenError(error);

      logVoiceTokenStage('error', 'voice_token_mint_failed', {
        requestId,
        userPrefix: verifiedUserId.slice(0, 8),
        upstreamStatus: diag.status,
        errorName: diag.name,
        errorCode: diag.code,
        sanitizedMessage: diag.sanitizedMessage,
        mappedStatus: mapped.status,
        mappedCode: mapped.code,
        elapsedMs: Date.now() - startedAtMs,
      });

      return jsonResponse(
        {
          error: mapped.message,
          code: mapped.code,
        },
        mapped.status,
        {
          'X-Klyvo-Request-Id': requestId,
        },
      );
    }
  };
}

const handleVoiceToken = createVoiceTokenHandler();
export default handleVoiceToken;
