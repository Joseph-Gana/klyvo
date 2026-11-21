import {
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentResponse,
} from '@google/genai';

export interface ValidatedChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ValidatedChatRequest {
  messages: ValidatedChatTurn[];
}

export type TimeoutStage =
  | 'connect'
  | 'first_text'
  | 'idle'
  | 'max_duration';

export class ChatValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ChatValidationError';
    this.status = status;
    this.code = code;
  }
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const DEFAULT_THINKING_LEVEL: ThinkingLevel = ThinkingLevel.MINIMAL;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_FIRST_TEXT_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_STREAM_DURATION_MS = 180_000;

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100 KB
const MAX_HISTORY_MESSAGES = 40;
const MAX_SINGLE_MESSAGE_CHARS = 16_000;
const MAX_TOTAL_CHARS = 64_000;

const MAX_MODEL_CONTEXT_TURNS = 24;
const MAX_MODEL_CONTEXT_CHARS = 32_000;

export const KLYVO_SYSTEM_INSTRUCTION = [
  'You are Klyvo, a helpful, accurate, and concise AI assistant built by Klyscape.',
  'Format responses clearly with well-structured Markdown and fenced code blocks with language tags when appropriate.',
  'Be honest when you are unsure or do not have enough information.',
  'Never invent or guess URLs, unverified facts, or nonexistent sources.',
].join(' ');

export class GeminiTimeoutError extends Error {
  code: string;
  status: number;
  timeoutStage: TimeoutStage;

  constructor(
    message = 'Gemini request timed out before completing.',
    timeoutStage: TimeoutStage = 'connect',
  ) {
    super(message);
    this.name = 'GeminiTimeoutError';
    this.code = 'GEMINI_TIMEOUT';
    this.status = 504;
    this.timeoutStage = timeoutStage;
  }
}

function parseClampedEnvInt(
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getGeminiConnectTimeoutMs(): number {
  return parseClampedEnvInt(
    process.env.GEMINI_REQUEST_TIMEOUT_MS,
    DEFAULT_CONNECT_TIMEOUT_MS,
    3_000,
    120_000,
  );
}

export function getGeminiFirstTextTimeoutMs(): number {
  return parseClampedEnvInt(
    process.env.GEMINI_FIRST_TEXT_TIMEOUT_MS,
    DEFAULT_FIRST_TEXT_TIMEOUT_MS,
    5_000,
    180_000,
  );
}

export function getGeminiStreamIdleTimeoutMs(): number {
  return parseClampedEnvInt(
    process.env.GEMINI_STREAM_IDLE_TIMEOUT_MS,
    DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    5_000,
    180_000,
  );
}

export function getGeminiMaxStreamDurationMs(): number {
  return parseClampedEnvInt(
    process.env.GEMINI_MAX_STREAM_DURATION_MS,
    DEFAULT_MAX_STREAM_DURATION_MS,
    15_000,
    300_000,
  );
}

export function getConfiguredGeminiModel(): string {
  const configured = (process.env.GEMINI_MODEL || '').trim();
  return configured || DEFAULT_GEMINI_MODEL;
}

export function getConfiguredThinkingLevel(
  model: string,
): ThinkingLevel | undefined {
  const lowerModel = model.toLowerCase();
  const supportsThinking =
    lowerModel.startsWith('gemini-4') || lowerModel.startsWith('gemini-3');
  if (!supportsThinking) {
    return undefined;
  }

  const raw = (process.env.GEMINI_THINKING_LEVEL || '').trim().toLowerCase();
  if (raw === 'default' || raw === 'auto') {
    return undefined;
  }

  const levelMap: Record<string, ThinkingLevel> = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  };

  // flash-lite models (including gemini-3.5-flash-lite) support ThinkingLevel.MINIMAL
  // for lowest latency; non-lite Gemini 3/4 models require LOW/MEDIUM/HIGH.
  const isFlashLite = lowerModel.includes('flash-lite');
  const allowedForModel: ReadonlySet<string> = isFlashLite
    ? new Set(['minimal', 'low', 'medium', 'high'])
    : new Set(['low', 'medium', 'high']);

  if (raw && allowedForModel.has(raw) && levelMap[raw]) {
    return levelMap[raw];
  }

  if (isFlashLite) {
    return DEFAULT_THINKING_LEVEL;
  }

  return ThinkingLevel.LOW;
}

export function isGeminiConfigured(): boolean {
  return Boolean((process.env.GEMINI_API_KEY || '').trim());
}

/**
 * Always initializes GoogleGenAI directly from the current server-side
 * GEMINI_API_KEY environment variable so no stale or old API key is ever
 * cached across environment updates or restarts.
 */
export function createGeminiClient(): GoogleGenAI {
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
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export const MAX_CHAT_PAYLOAD_BYTES = MAX_PAYLOAD_BYTES;

async function readRequestTextWithByteLimit(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (!request.body) {
    throw new ChatValidationError(
      'Request body cannot be empty.',
      400,
      'EMPTY_REQUEST_BODY',
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('Request payload exceeded maximum allowed size.');
        } catch {
          // Ignore stream cancellation errors on closing streams
        }
        throw new ChatValidationError(
          'Request payload exceeds the maximum allowed size.',
          413,
          'PAYLOAD_TOO_LARGE',
        );
      }

      chunks.push(value);
    }
  } catch (error: unknown) {
    if (error instanceof ChatValidationError) {
      throw error;
    }
    try {
      await reader.cancel().catch(() => undefined);
    } catch {
      // Ignore stream cancellation errors
    }
    throw new ChatValidationError(
      'Unable to read request body.',
      400,
      'INVALID_REQUEST_BODY',
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released after cancel
    }
  }

  if (totalBytes === 0) {
    throw new ChatValidationError(
      'Request body cannot be empty.',
      400,
      'EMPTY_REQUEST_BODY',
    );
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const rawBody = new TextDecoder('utf-8').decode(combined);
  if (!rawBody.trim()) {
    throw new ChatValidationError(
      'Request body cannot be empty.',
      400,
      'EMPTY_REQUEST_BODY',
    );
  }

  return rawBody;
}

export async function parseAndValidateChatRequest(
  request: Request,
): Promise<ValidatedChatRequest> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ChatValidationError(
      'Content-Type must be application/json.',
      400,
      'INVALID_CONTENT_TYPE',
    );
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PAYLOAD_BYTES) {
      if (request.body && !request.body.locked) {
        await request.body.cancel().catch(() => undefined);
      }
      throw new ChatValidationError(
        'Request payload exceeds the maximum allowed size.',
        413,
        'PAYLOAD_TOO_LARGE',
      );
    }
  }

  const rawBody = await readRequestTextWithByteLimit(request, MAX_PAYLOAD_BYTES);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ChatValidationError(
      'Malformed JSON request payload.',
      400,
      'MALFORMED_JSON',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ChatValidationError(
      'Request body must be a JSON object.',
      400,
      'INVALID_REQUEST_OBJECT',
    );
  }

  const body = parsed as Record<string, unknown>;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ChatValidationError(
      'At least one chat message is required.',
      400,
      'EMPTY_MESSAGES',
    );
  }

  if (body.messages.length > MAX_HISTORY_MESSAGES) {
    throw new ChatValidationError(
      `Conversation history exceeds the maximum of ${MAX_HISTORY_MESSAGES} messages per request.`,
      413,
      'HISTORY_TOO_LONG',
    );
  }

  let totalChars = 0;
  const validatedMessages: ValidatedChatTurn[] = [];

  for (const item of body.messages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ChatValidationError(
        'Each message must be an object with role and content.',
        400,
        'INVALID_MESSAGE_ITEM',
      );
    }

    const msg = item as Record<string, unknown>;
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      throw new ChatValidationError(
        'Message role must be "user" or "assistant".',
        400,
        'INVALID_MESSAGE_ROLE',
      );
    }

    if (typeof msg.content !== 'string') {
      throw new ChatValidationError(
        'Message content must be a string.',
        400,
        'INVALID_MESSAGE_CONTENT',
      );
    }

    const trimmed = msg.content.trim();
    if (!trimmed) {
      throw new ChatValidationError(
        'Message content cannot be empty.',
        400,
        'EMPTY_MESSAGE_CONTENT',
      );
    }

    if (trimmed.length > MAX_SINGLE_MESSAGE_CHARS) {
      throw new ChatValidationError(
        `A single message exceeds the ${MAX_SINGLE_MESSAGE_CHARS.toLocaleString()} character limit.`,
        413,
        'MESSAGE_TOO_LARGE',
      );
    }

    totalChars += trimmed.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      throw new ChatValidationError(
        'Total conversation context exceeds the maximum allowed length.',
        413,
        'CONTEXT_TOO_LARGE',
      );
    }

    validatedMessages.push({
      role: msg.role,
      content: trimmed,
    });
  }

  const lastMessage = validatedMessages[validatedMessages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    throw new ChatValidationError(
      'The latest message in the request must come from the user.',
      400,
      'LAST_MESSAGE_MUST_BE_USER',
    );
  }

  return {
    messages: validatedMessages,
  };
}

function mergeConsecutiveTurns(messages: ValidatedChatTurn[]): ValidatedChatTurn[] {
  const mergedTurns: ValidatedChatTurn[] = [];

  for (const turn of messages) {
    const prev = mergedTurns[mergedTurns.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = `${prev.content}\n\n${turn.content}`;
    } else {
      mergedTurns.push({ role: turn.role, content: turn.content });
    }
  }

  return mergedTurns;
}

/**
 * Keeps the most recent turns within a fast-response character & turn budget
 * while always preserving the latest user prompt.
 */
export function trimInteractionTurns(
  messages: ValidatedChatTurn[],
  maxTurns = MAX_MODEL_CONTEXT_TURNS,
  maxChars = MAX_MODEL_CONTEXT_CHARS,
): ValidatedChatTurn[] {
  const merged = mergeConsecutiveTurns(messages);
  if (merged.length <= 1) return merged;

  const selectedReversed: ValidatedChatTurn[] = [];
  let charBudgetUsed = 0;

  for (let i = merged.length - 1; i >= 0; i -= 1) {
    const turn = merged[i];
    const isLatestTurn = i === merged.length - 1;
    if (!isLatestTurn) {
      if (selectedReversed.length >= maxTurns) break;
      if (charBudgetUsed + turn.content.length > maxChars) break;
    }
    selectedReversed.push(turn);
    charBudgetUsed += turn.content.length;
  }

  return selectedReversed.reverse();
}

export function buildGenerateContentContents(
  messages: ValidatedChatTurn[],
): Content[] {
  const budgetedTurns = trimInteractionTurns(messages);

  return budgetedTurns.map((turn): Content => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }],
  }));
}

export interface ChatModelsClientLike {
  models: {
    generateContentStream: GoogleGenAI['models']['generateContentStream'];
  };
}

export interface KlyvoChatStreamResult {
  stream: AsyncIterable<GenerateContentResponse>;
  model: string;
  thinkingLevel: string;
}

const TRANSIENT_PRE_STREAM_RETRY_STATUSES = new Set([408, 500, 502, 503, 504]);

export function isQuotaOrRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const diag = extractGeminiErrorDiagnostics(error);
  const lower = `${diag.code ?? ''} ${diag.sanitizedMessage} ${diag.name}`.toLowerCase();
  return (
    diag.status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  );
}

export function isTransientPreStreamRetryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof GeminiTimeoutError) return false;
  if (isQuotaOrRateLimitError(error)) return false;

  const diag = extractGeminiErrorDiagnostics(error);
  const lower = `${diag.code ?? ''} ${diag.sanitizedMessage} ${diag.name}`.toLowerCase();

  if (diag.status !== null) {
    if (TRANSIENT_PRE_STREAM_RETRY_STATUSES.has(diag.status)) return true;
    if (diag.status >= 400 && diag.status < 500) return false;
  }

  if (
    lower.includes('invalid_argument') ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('not_found') ||
    lower.includes('not found') ||
    diag.name === 'BadRequestError'
  ) {
    return false;
  }

  return (
    diag.name === 'APIConnectionError' ||
    diag.name === 'ConnectionError' ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('gateway timeout')
  );
}

async function waitForRetryBackoff(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function createKlyvoChatStream(params: {
  messages: ValidatedChatTurn[];
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  retryDelayMs?: number;
  client?: ChatModelsClientLike;
}): Promise<KlyvoChatStreamResult> {
  const ai = params.client ?? createGeminiClient();
  const model = getConfiguredGeminiModel();
  const thinkingLevel = getConfiguredThinkingLevel(model);
  const contents = buildGenerateContentContents(params.messages);
  const connectTimeoutMs = params.connectTimeoutMs ?? getGeminiConnectTimeoutMs();

  const requestController = new AbortController();
  let connectTimedOut = false;

  const onCallerAbort = () => {
    requestController.abort(params.signal?.reason);
  };

  if (params.signal) {
    if (params.signal.aborted) {
      requestController.abort(params.signal.reason);
      throw params.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    params.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const connectTimer = setTimeout(() => {
    if (!requestController.signal.aborted) {
      connectTimedOut = true;
      requestController.abort(
        new GeminiTimeoutError(
          `Gemini took longer than ${Math.round(connectTimeoutMs / 1000)}s to open a response stream.`,
          'connect',
        ),
      );
    }
  }, connectTimeoutMs);

  const openStream = () =>
    ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: KLYVO_SYSTEM_INSTRUCTION,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        automaticContinuation: false,
        abortSignal: requestController.signal,
        httpOptions: {
          timeout: Math.max(connectTimeoutMs, 10_000),
        },
      },
    });

  let streamOpened = false;
  try {
    try {
      const stream = await openStream();
      streamOpened = true;
      return {
        stream,
        model,
        thinkingLevel: thinkingLevel ?? 'default',
      };
    } catch (firstError: unknown) {
      if (
        connectTimedOut ||
        requestController.signal.aborted ||
        params.signal?.aborted ||
        !isTransientPreStreamRetryError(firstError)
      ) {
        throw firstError;
      }

      const backoffMs = params.retryDelayMs ?? 300;
      await waitForRetryBackoff(backoffMs, requestController.signal);

      const retriedStream = await openStream();
      streamOpened = true;
      return {
        stream: retriedStream,
        model,
        thinkingLevel: thinkingLevel ?? 'default',
      };
    }
  } catch (error: unknown) {
    if (connectTimedOut) {
      throw new GeminiTimeoutError(
        `Gemini took longer than ${Math.round(connectTimeoutMs / 1000)}s to open a response stream.`,
        'connect',
      );
    }
    throw error;
  } finally {
    clearTimeout(connectTimer);
    if (!streamOpened) {
      params.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

export interface ExtractedChunkDetails {
  text: string;
  hasThoughtPart: boolean;
  finishReason: string | null;
}

export function extractGenerateContentChunkDetails(
  chunk: GenerateContentResponse,
): ExtractedChunkDetails {
  const firstCandidate = chunk.candidates?.[0];
  const parts = firstCandidate?.content?.parts;

  let text = '';
  let hasThoughtPart = false;

  if (Array.isArray(parts) && parts.length > 0) {
    for (const part of parts) {
      if (part?.thought === true) {
        hasThoughtPart = true;
        continue;
      }
      if (typeof part?.text === 'string' && part.text.length > 0) {
        text += part.text;
      }
    }
  } else if (typeof chunk.text === 'string' && chunk.text.length > 0) {
    text = chunk.text;
  }

  return {
    text,
    hasThoughtPart,
    finishReason:
      typeof firstCandidate?.finishReason === 'string'
        ? firstCandidate.finishReason
        : null,
  };
}

export interface GeminiErrorDiagnostics {
  name: string;
  status: number | null;
  code: string | null;
  sanitizedMessage: string;
}

export function sanitizeDiagnosticMessage(raw: string): string {
  const compact = raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g, '[REDACTED_JWT]')
    .replace(/\s+/g, ' ')
    .trim();

  if (compact.length <= 360) return compact;
  return `${compact.slice(0, 357)}...`;
}

export function extractGeminiErrorDiagnostics(
  error: unknown,
): GeminiErrorDiagnostics {
  const obj =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : null;

  const name =
    error instanceof Error
      ? error.name
      : obj && typeof obj.name === 'string'
        ? obj.name
        : 'UnknownError';

  let status: number | null = null;
  if (obj) {
    if (typeof obj.status === 'number') {
      status = obj.status;
    } else if (typeof obj.statusCode === 'number') {
      status = obj.statusCode;
    } else if (
      typeof obj.error === 'object' &&
      obj.error !== null &&
      typeof (obj.error as { code?: unknown }).code === 'number'
    ) {
      status = (obj.error as { code: number }).code;
    }
  }

  let code: string | null = null;
  if (obj) {
    if (typeof obj.code === 'string' && obj.code.trim()) {
      code = obj.code.trim();
    } else if (
      typeof obj.error === 'object' &&
      obj.error !== null &&
      typeof (obj.error as { status?: unknown }).status === 'string'
    ) {
      code = String((obj.error as { status: string }).status).trim() || null;
    } else if (
      typeof obj.error === 'object' &&
      obj.error !== null &&
      typeof (obj.error as { code?: unknown }).code === 'string'
    ) {
      code = String((obj.error as { code: string }).code).trim() || null;
    }
  }

  const rawParts: string[] = [];
  if (error instanceof Error && error.message) {
    rawParts.push(error.message);
  } else if (obj && typeof obj.message === 'string' && obj.message) {
    rawParts.push(obj.message);
  }
  if (
    obj &&
    typeof obj.error === 'object' &&
    obj.error !== null &&
    typeof (obj.error as { message?: unknown }).message === 'string'
  ) {
    const nested = (obj.error as { message: string }).message;
    if (nested && !rawParts.includes(nested)) {
      rawParts.push(nested);
    }
  }
  if (obj && typeof obj.cause === 'object' && obj.cause !== null) {
    const causeMsg =
      obj.cause instanceof Error
        ? obj.cause.message
        : typeof (obj.cause as { message?: unknown }).message === 'string'
          ? String((obj.cause as { message: string }).message)
          : '';
    if (causeMsg && !rawParts.includes(causeMsg)) {
      rawParts.push(`cause: ${causeMsg}`);
    }
  }

  return {
    name,
    status,
    code,
    sanitizedMessage: sanitizeDiagnosticMessage(rawParts.join(' | ')),
  };
}

export function getTimeoutCategoryCode(error: GeminiTimeoutError): string {
  switch (error.timeoutStage) {
    case 'connect':
      return 'GEMINI_CONNECT_TIMEOUT';
    case 'first_text':
      return 'GEMINI_FIRST_TEXT_TIMEOUT';
    case 'idle':
      return 'GEMINI_IDLE_TIMEOUT';
    case 'max_duration':
      return 'GEMINI_MAX_DURATION_TIMEOUT';
    default:
      return 'GEMINI_TIMEOUT';
  }
}

export function mapSafeGeminiError(
  error: unknown,
): { code: string; category: string; message: string; status: number } {
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
      code: 'GEMINI_QUOTA_EXCEEDED',
      category: 'GEMINI_QUOTA_EXCEEDED',
      message:
        'Gemini API quota or rate limit was reached for text generation. Please wait a moment and try again.',
    };
  }

  if (
    statusCode === 503 ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('service unavailable')
  ) {
    return {
      status: 503,
      code: 'GEMINI_MODEL_UNAVAILABLE_503',
      category: 'GEMINI_SERVICE_UNAVAILABLE',
      message:
        'The selected Gemini model is temporarily experiencing high demand (503). Please try again in a moment.',
    };
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid')
  ) {
    return {
      status: statusCode === 403 ? 403 : 401,
      code: 'GEMINI_AUTH_ERROR',
      category: 'GEMINI_AUTH_ERROR',
      message:
        'The server Gemini API key is invalid or lacks permission for this request.',
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
      code: 'GEMINI_MODEL_UNAVAILABLE',
      category: 'GEMINI_MODEL_NOT_FOUND',
      message:
        'The configured Gemini model could not be found or is unavailable for this API key.',
    };
  }

  if (statusCode === 400 || lower.includes('invalid_argument') || diag.name === 'BadRequestError') {
    return {
      status: 400,
      code: 'GEMINI_INVALID_REQUEST',
      category: 'GEMINI_INVALID_REQUEST',
      message:
        'The Gemini API rejected the chat request configuration. Please verify the model configuration or try again.',
    };
  }

  if (
    error instanceof GeminiTimeoutError ||
    diag.name === 'GeminiTimeoutError' ||
    diag.name === 'RequestTimeoutError' ||
    diag.code === 'GEMINI_TIMEOUT' ||
    statusCode === 504 ||
    lower.includes('timed out') ||
    lower.includes('deadline_exceeded')
  ) {
    const category =
      error instanceof GeminiTimeoutError
        ? getTimeoutCategoryCode(error)
        : 'GEMINI_DEADLINE_EXCEEDED';
    const message =
      error instanceof GeminiTimeoutError && error.timeoutStage === 'connect'
        ? 'Gemini did not open a streaming connection in time. Please try again.'
        : error instanceof GeminiTimeoutError && error.timeoutStage === 'first_text'
          ? 'Gemini took too long before generating its first answer tokens. Please try again.'
          : error instanceof GeminiTimeoutError && error.timeoutStage === 'idle'
            ? 'Gemini stalled mid-response without sending updates. Please try again.'
            : 'Gemini took too long to respond (504). Please retry or try again in a moment.';

    return {
      status: 504,
      code: 'GEMINI_TIMEOUT',
      category,
      message,
    };
  }

  if (
    diag.name === 'APIConnectionError' ||
    diag.name === 'ConnectionError' ||
    lower.includes('fetch failed') ||
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset')
  ) {
    return {
      status: 502,
      code: 'GEMINI_CONNECTION_ERROR',
      category: 'GEMINI_CONNECTION_ERROR',
      message:
        'Unable to reach the Gemini AI service right now. Please try again in a moment.',
    };
  }

  return {
    status: 502,
    code: 'GEMINI_STREAM_ERROR',
    category: 'GEMINI_STREAM_ERROR',
    message:
      'Unable to complete the Gemini AI response right now. Please try again.',
  };
}
