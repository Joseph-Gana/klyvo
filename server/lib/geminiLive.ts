import {
  GoogleGenAI,
  Modality,
  type AuthToken,
  type CreateAuthTokenParameters,
} from '@google/genai';
import {
  ChatValidationError,
  extractGeminiErrorDiagnostics,
  isGeminiConfigured,
} from './gemini';

export const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-3.8-live';
export const GEMINI_LIVE_API_VERSION = 'v1alpha' as const;

const DEFAULT_NEW_SESSION_TTL_MS = 60_000; // 1 minute to initiate Live WebSocket session
const DEFAULT_TOKEN_TTL_MS = 30 * 60_000; // 30 minutes max token lifetime
const DEFAULT_TOKEN_TIMEOUT_MS = 15_000;

export interface VoiceTokenMintResult {
  token: string;
  model: string;
  apiVersion: typeof GEMINI_LIVE_API_VERSION;
  expireTime: string;
  newSessionExpireTime: string;
  uses: number;
}

export interface AuthTokensClientLike {
  authTokens: {
    create: (params: CreateAuthTokenParameters) => Promise<AuthToken>;
  };
}

export function getConfiguredGeminiLiveModel(): string {
  const configured = (process.env.GEMINI_LIVE_MODEL || '').trim();
  return configured || DEFAULT_GEMINI_LIVE_MODEL;
}

/**
 * Always initializes a fresh GoogleGenAI v1alpha client directly from the
 * current server-side GEMINI_API_KEY environment variable so no stale key is
 * ever cached across environment updates or restarts.
 */
export function createGeminiLiveServerClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new ChatValidationError(
      'Gemini API service is not configured on the server.',
      500,
      'GEMINI_NOT_CONFIGURED',
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: GEMINI_LIVE_API_VERSION,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function createEphemeralTokenLiveClient(ephemeralToken: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: ephemeralToken,
    httpOptions: {
      apiVersion: GEMINI_LIVE_API_VERSION,
    },
  });
}

export async function mintGeminiLiveEphemeralToken(params?: {
  model?: string;
  nowMs?: number;
  signal?: AbortSignal;
  client?: AuthTokensClientLike;
}): Promise<VoiceTokenMintResult> {
  if (!params?.client && !isGeminiConfigured()) {
    throw new ChatValidationError(
      'Gemini API service is not configured on the server.',
      500,
      'GEMINI_NOT_CONFIGURED',
    );
  }

  const ai = params?.client ?? createGeminiLiveServerClient();
  const model = (params?.model || '').trim() || getConfiguredGeminiLiveModel();
  const nowMs = params?.nowMs ?? Date.now();
  const newSessionExpireTime = new Date(
    nowMs + DEFAULT_NEW_SESSION_TTL_MS,
  ).toISOString();
  const expireTime = new Date(nowMs + DEFAULT_TOKEN_TTL_MS).toISOString();
  const uses = 1;

  const authToken = await ai.authTokens.create({
    config: {
      uses,
      newSessionExpireTime,
      expireTime,
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
        },
      },
      lockAdditionalFields: [],
      ...(params?.signal ? { abortSignal: params.signal } : {}),
      httpOptions: {
        timeout: DEFAULT_TOKEN_TIMEOUT_MS,
      },
    },
  });

  const tokenName = typeof authToken?.name === 'string' ? authToken.name.trim() : '';
  if (!tokenName) {
    throw new Error('Gemini authTokens.create returned an empty token.');
  }

  return {
    token: tokenName,
    model,
    apiVersion: GEMINI_LIVE_API_VERSION,
    expireTime,
    newSessionExpireTime,
    uses,
  };
}

export function mapSafeVoiceTokenError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const diag = extractGeminiErrorDiagnostics(error);
  const lower = `${diag.code ?? ''} ${diag.sanitizedMessage} ${diag.name}`.toLowerCase();
  const statusCode = diag.status ?? 500;

  if (
    statusCode === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return {
      status: 429,
      code: 'GEMINI_LIVE_QUOTA_EXCEEDED',
      message:
        'Gemini Live API quota or rate limit was reached for this API key. Please check plan limits or try again later.',
    };
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('billing')
  ) {
    return {
      status: statusCode === 401 ? 401 : 403,
      code: 'GEMINI_LIVE_PERMISSION_DENIED',
      message:
        'The server Gemini API key does not have permission to mint Gemini Live ephemeral tokens.',
    };
  }

  if (
    statusCode === 404 ||
    lower.includes('not_found') ||
    lower.includes('not found') ||
    (lower.includes('model') &&
      (lower.includes('unsupported') || lower.includes('invalid') || lower.includes('unknown')))
  ) {
    return {
      status: 404,
      code: 'GEMINI_LIVE_MODEL_UNAVAILABLE',
      message:
        'The configured Gemini Live model was not found or is not available for ephemeral tokens on this API key.',
    };
  }

  if (statusCode === 400 || lower.includes('invalid_argument') || diag.name === 'BadRequestError') {
    return {
      status: 400,
      code: 'GEMINI_LIVE_INVALID_REQUEST',
      message:
        'The Gemini Live API rejected the ephemeral token configuration.',
    };
  }

  if (
    statusCode === 503 ||
    lower.includes('unavailable') ||
    lower.includes('service unavailable')
  ) {
    return {
      status: 503,
      code: 'GEMINI_LIVE_UNAVAILABLE',
      message:
        'Gemini Live token service is temporarily unavailable. Please try again in a moment.',
    };
  }

  return {
    status: 502,
    code: 'GEMINI_LIVE_TOKEN_ERROR',
    message:
      'Unable to mint a Gemini Live ephemeral token right now.',
  };
}
