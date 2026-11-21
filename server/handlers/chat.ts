import { randomUUID } from 'node:crypto';
import type { GenerateContentResponse } from '@google/genai';
import {
  AuthVerificationError,
  extractBearerToken,
  isServerSupabaseAuthConfigured,
  verifySupabaseRequestAuth,
} from '../lib/auth';
import {
  ChatValidationError,
  createKlyvoChatStream,
  extractGeminiErrorDiagnostics,
  extractGenerateContentChunkDetails,
  GeminiTimeoutError,
  getConfiguredGeminiModel,
  getConfiguredThinkingLevel,
  getGeminiConnectTimeoutMs,
  getGeminiFirstTextTimeoutMs,
  getGeminiMaxStreamDurationMs,
  getGeminiStreamIdleTimeoutMs,
  isGeminiConfigured,
  type KlyvoChatStreamResult,
  mapSafeGeminiError,
  parseAndValidateChatRequest,
  sanitizeDiagnosticMessage,
} from '../lib/gemini';
import { checkUserRateLimit } from '../lib/rateLimit';

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export interface ChatHandlerDeps {
  extractBearerToken?: typeof extractBearerToken;
  isServerSupabaseAuthConfigured?: typeof isServerSupabaseAuthConfigured;
  isGeminiConfigured?: typeof isGeminiConfigured;
  verifySupabaseRequestAuth?: typeof verifySupabaseRequestAuth;
  checkUserRateLimit?: typeof checkUserRateLimit;
  parseAndValidateChatRequest?: typeof parseAndValidateChatRequest;
  createKlyvoChatStream?: (
    params: Parameters<typeof createKlyvoChatStream>[0],
  ) => Promise<KlyvoChatStreamResult | AsyncIterable<GenerateContentResponse>>;
  getConfiguredGeminiModel?: typeof getConfiguredGeminiModel;
  getConfiguredThinkingLevel?: typeof getConfiguredThinkingLevel;
  connectTimeoutMs?: number;
  firstTextTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  maxStreamDurationMs?: number;
  keepaliveIntervalMs?: number;
}

function isKlyvoChatStreamResult(
  value: KlyvoChatStreamResult | AsyncIterable<GenerateContentResponse>,
): value is KlyvoChatStreamResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'stream' in value &&
    'model' in value
  );
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

function encodeSseEvent(event: string, data: Record<string, unknown>): Uint8Array {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: unknown }).name) : '';
  return (
    name === 'AbortError' ||
    name === 'APIUserAbortError' ||
    name === 'RequestAbortedError'
  );
}

function logChatStage(
  level: 'info' | 'warn' | 'error',
  stage: string,
  details: Record<string, unknown>,
): void {
  const entry = JSON.stringify({
    scope: 'api/chat',
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

export function createChatHandler(deps: ChatHandlerDeps = {}) {
  const getBearer = deps.extractBearerToken ?? extractBearerToken;
  const checkSupabaseCfg =
    deps.isServerSupabaseAuthConfigured ?? isServerSupabaseAuthConfigured;
  const checkGeminiCfg = deps.isGeminiConfigured ?? isGeminiConfigured;
  const verifyAuth = deps.verifySupabaseRequestAuth ?? verifySupabaseRequestAuth;
  const rateLimitCheck = deps.checkUserRateLimit ?? checkUserRateLimit;
  const validateBody =
    deps.parseAndValidateChatRequest ?? parseAndValidateChatRequest;
  const openChatStream = deps.createKlyvoChatStream ?? createKlyvoChatStream;
  const getModel = deps.getConfiguredGeminiModel ?? getConfiguredGeminiModel;
  const getThinkingLevel =
    deps.getConfiguredThinkingLevel ?? getConfiguredThinkingLevel;

  return async function handleChat(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          Allow: 'POST, OPTIONS',
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
      logChatStage('warn', 'auth_missing_token', { requestId, status: 401 });
      return jsonResponse(
        {
          error: 'Authentication required. Provide a valid Bearer access token.',
          code: 'MISSING_ACCESS_TOKEN',
        },
        401,
      );
    }

    if (!checkSupabaseCfg()) {
      logChatStage('error', 'config_supabase_missing', { requestId, status: 500 });
      return jsonResponse(
        {
          error: 'Server authentication is not configured.',
          code: 'SUPABASE_AUTH_NOT_CONFIGURED',
        },
        500,
      );
    }

    if (!checkGeminiCfg()) {
      logChatStage('error', 'config_gemini_missing', { requestId, status: 500 });
      return jsonResponse(
        {
          error: 'Gemini chat service is not configured on the server.',
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
        logChatStage('warn', 'auth_rejected', {
          requestId,
          status: error.status,
          code: error.code,
        });
        return jsonResponse(
          { error: error.message, code: error.code },
          error.status,
        );
      }
      logChatStage('warn', 'auth_verification_exception', {
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

    const rateLimit = rateLimitCheck(verifiedUserId);
    if (!rateLimit.allowed) {
      logChatStage('warn', 'rate_limited', {
        requestId,
        status: 429,
        userPrefix: verifiedUserId.slice(0, 8),
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
      return jsonResponse(
        {
          error: `Rate limit exceeded (${rateLimit.limit} requests/min per instance). Please wait ${rateLimit.retryAfterSeconds}s and try again.`,
          code: 'RATE_LIMITED',
        },
        429,
        {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      );
    }

    let validatedRequest;
    try {
      validatedRequest = await validateBody(request);
    } catch (error: unknown) {
      if (error instanceof ChatValidationError) {
        logChatStage('warn', 'validation_failed', {
          requestId,
          status: error.status,
          code: error.code,
        });
        return jsonResponse(
          { error: error.message, code: error.code },
          error.status,
        );
      }
      logChatStage('warn', 'validation_exception', {
        requestId,
        status: 400,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return jsonResponse(
        { error: 'Invalid chat request.', code: 'INVALID_REQUEST' },
        400,
      );
    }

    const streamAbortController = new AbortController();
    let clientAborted = request.signal.aborted;
    const handleClientAbort = () => {
      clientAborted = true;
      streamAbortController.abort();
    };

    if (clientAborted) {
      logChatStage('info', 'client_aborted_before_stream', { requestId });
      return new Response(null, { status: 499 });
    }
    request.signal.addEventListener('abort', handleClientAbort, { once: true });

    const configuredModel = getModel();
    const configuredThinkingLevel = getThinkingLevel(configuredModel) ?? 'default';
    const connectTimeoutMs =
      deps.connectTimeoutMs ?? getGeminiConnectTimeoutMs();
    const firstTextTimeoutMs =
      deps.firstTextTimeoutMs ?? getGeminiFirstTextTimeoutMs();
    const idleTimeoutMs =
      deps.streamIdleTimeoutMs ?? getGeminiStreamIdleTimeoutMs();
    const maxDurationMs =
      deps.maxStreamDurationMs ?? getGeminiMaxStreamDurationMs();
    const keepaliveIntervalMs = deps.keepaliveIntervalMs ?? 10_000;

    let isStreamClosed = false;

    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const observedFinishReasons = new Set<string>();

        let activeModel = configuredModel;
        let activeThinkingLevel = String(configuredThinkingLevel);

        let receivedText = false;
        let sentTerminalEvent = false;
        let totalChunks = 0;
        let thoughtChunkCount = 0;
        let textDeltaCount = 0;
        let totalTextChars = 0;
        let firstChunkMs: number | null = null;
        let firstTextMs: number | null = null;
        let prevTextDeltaMs: number | null = null;
        let lastProgressCommentMs = 0;
        let lastResponseId: string | undefined;
        let blockedReason: string | null = null;
        let timeoutError: GeminiTimeoutError | null = null;
        let streamOpened = false;

        const streamStartedMs = Date.now();
        const encoder = new TextEncoder();

        const enqueue = (chunk: Uint8Array) => {
          if (isStreamClosed || clientAborted) return;
          try {
            controller.enqueue(chunk);
          } catch {
            isStreamClosed = true;
          }
        };

        const emitComment = (comment: string) => {
          enqueue(encoder.encode(`: ${comment}\n\n`));
        };

        const emitMetaEvent = () => {
          enqueue(
            encodeSseEvent('meta', {
              model: activeModel,
              thinkingLevel: activeThinkingLevel,
              apiMode: 'generateContentStream',
              requestStartedAt: new Date(startedAtMs).toISOString(),
              serverPreflightMs: Date.now() - startedAtMs,
            }),
          );
        };

        // Emit SSE open comment + non-secret request metadata immediately without any
        // artificial proxy padding buffers.
        emitComment('stream-open');
        emitMetaEvent();

        let firstTextTimer: ReturnType<typeof setTimeout> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let maxDurationTimer: ReturnType<typeof setTimeout> | undefined;

        const clearFirstTextWatchdog = () => {
          if (firstTextTimer !== undefined) {
            clearTimeout(firstTextTimer);
            firstTextTimer = undefined;
          }
        };

        const clearWatchdogs = () => {
          clearFirstTextWatchdog();
          if (idleTimer !== undefined) {
            clearTimeout(idleTimer);
            idleTimer = undefined;
          }
          if (maxDurationTimer !== undefined) {
            clearTimeout(maxDurationTimer);
            maxDurationTimer = undefined;
          }
        };

        const startFirstTextWatchdog = () => {
          clearFirstTextWatchdog();
          firstTextTimer = setTimeout(() => {
            if (
              !receivedText &&
              !isStreamClosed &&
              !clientAborted &&
              !streamAbortController.signal.aborted
            ) {
              timeoutError = new GeminiTimeoutError(
                `Gemini took longer than ${Math.round(firstTextTimeoutMs / 1000)}s before producing text tokens.`,
                'first_text',
              );
              streamAbortController.abort(timeoutError);
            }
          }, firstTextTimeoutMs);
        };

        const resetIdleWatchdog = () => {
          if (idleTimer !== undefined) {
            clearTimeout(idleTimer);
          }
          idleTimer = setTimeout(() => {
            if (
              !isStreamClosed &&
              !clientAborted &&
              !streamAbortController.signal.aborted
            ) {
              timeoutError = new GeminiTimeoutError(
                `Gemini stream stalled for ${Math.round(idleTimeoutMs / 1000)}s without emitting upstream chunks.`,
                'idle',
              );
              streamAbortController.abort(timeoutError);
            }
          }, idleTimeoutMs);
        };

        maxDurationTimer = setTimeout(() => {
          if (
            !isStreamClosed &&
            !clientAborted &&
            !streamAbortController.signal.aborted
          ) {
            timeoutError = new GeminiTimeoutError(
              `Gemini stream exceeded the ${Math.round(maxDurationMs / 1000)}s maximum response window.`,
              'max_duration',
            );
            streamAbortController.abort(timeoutError);
          }
        }, maxDurationMs);

        const keepaliveTimer = setInterval(() => {
          if (isStreamClosed || streamAbortController.signal.aborted) {
            clearInterval(keepaliveTimer);
            return;
          }
          emitComment('keepalive');
        }, keepaliveIntervalMs);

        streamAbortController.signal.addEventListener(
          'abort',
          () => {
            clearInterval(keepaliveTimer);
            clearWatchdogs();
          },
          { once: true },
        );

        const emitTextDelta = (text: string) => {
          if (!receivedText) {
            receivedText = true;
            clearFirstTextWatchdog();
          }
          textDeltaCount += 1;
          totalTextChars += text.length;

          const nowMs = Date.now();
          const elapsedMs = nowMs - startedAtMs;
          const sinceStreamOpenMs = nowMs - streamStartedMs;
          const sincePrevDeltaMs =
            prevTextDeltaMs === null ? null : nowMs - prevTextDeltaMs;
          prevTextDeltaMs = nowMs;

          if (firstTextMs === null) {
            firstTextMs = elapsedMs;
            logChatStage('info', 'gemini_first_text_event', {
              requestId,
              model: activeModel,
              thinkingLevel: activeThinkingLevel,
              apiMode: 'generateContentStream',
              chunkChars: text.length,
              elapsedMs,
              sinceStreamOpenMs,
              thoughtChunksBeforeText: thoughtChunkCount,
            });
          }

          if (textDeltaCount <= 5 || textDeltaCount % 25 === 0) {
            logChatStage('info', 'sse_delta_enqueued', {
              requestId,
              deltaIndex: textDeltaCount,
              chunkChars: text.length,
              elapsedMs,
              sinceStreamOpenMs,
              sincePrevDeltaMs,
            });
          }

          enqueue(encodeSseEvent('delta', { text }));
        };

        const consumeUpstreamStream = async (
          geminiStream: AsyncIterable<GenerateContentResponse>,
        ) => {
          resetIdleWatchdog();
          startFirstTextWatchdog();

          for await (const chunk of geminiStream) {
            if (streamAbortController.signal.aborted || isStreamClosed) {
              break;
            }

            resetIdleWatchdog();
            totalChunks += 1;

            if (typeof chunk.responseId === 'string' && chunk.responseId.trim()) {
              lastResponseId = chunk.responseId.trim();
            }

            if (chunk.promptFeedback?.blockReason) {
              blockedReason = String(chunk.promptFeedback.blockReason);
            }

            const details = extractGenerateContentChunkDetails(chunk);

            if (details.finishReason) {
              observedFinishReasons.add(details.finishReason);
            }

            if (firstChunkMs === null) {
              firstChunkMs = Date.now() - startedAtMs;
              logChatStage('info', 'gemini_first_upstream_chunk', {
                requestId,
                model: activeModel,
                apiMode: 'generateContentStream',
                hasText: details.text.length > 0,
                hasThoughtPart: details.hasThoughtPart,
                elapsedMs: firstChunkMs,
                sinceStreamOpenMs: Date.now() - streamStartedMs,
              });
            }

            if (details.hasThoughtPart) {
              thoughtChunkCount += 1;
              const nowMs = Date.now();
              if (!receivedText && nowMs - lastProgressCommentMs >= 1_500) {
                lastProgressCommentMs = nowMs;
                emitComment('thinking');
              }
            }

            if (details.text) {
              emitTextDelta(details.text);
            }
          }
        };

        try {
          logChatStage('info', 'gemini_request_start', {
            requestId,
            model: activeModel,
            thinkingLevel: activeThinkingLevel,
            apiMode: 'generateContentStream',
            turnCount: validatedRequest.messages.length,
          });

          const rawOpened = await openChatStream({
            messages: validatedRequest.messages,
            signal: streamAbortController.signal,
            connectTimeoutMs,
          });

          let geminiStream: AsyncIterable<GenerateContentResponse>;
          if (isKlyvoChatStreamResult(rawOpened)) {
            geminiStream = rawOpened.stream;
            activeModel = rawOpened.model;
            activeThinkingLevel = rawOpened.thinkingLevel;
          } else {
            geminiStream = rawOpened;
          }
          streamOpened = true;

          logChatStage('info', 'gemini_stream_opened', {
            requestId,
            model: activeModel,
            thinkingLevel: activeThinkingLevel,
            apiMode: 'generateContentStream',
            elapsedMs: Date.now() - startedAtMs,
          });

          await consumeUpstreamStream(geminiStream);

          if (timeoutError && !sentTerminalEvent && !clientAborted && !isStreamClosed) {
            throw timeoutError;
          }

          if (
            !sentTerminalEvent &&
            !streamAbortController.signal.aborted &&
            !isStreamClosed
          ) {
            const completedElapsedMs = Date.now() - startedAtMs;

            if (receivedText) {
              logChatStage('info', 'gemini_stream_completed', {
                requestId,
                model: activeModel,
                thinkingLevel: activeThinkingLevel,
                apiMode: 'generateContentStream',
                responseId: lastResponseId ?? null,
                totalChunks,
                thoughtChunkCount,
                textDeltaCount,
                totalTextChars,
                firstChunkMs,
                firstTextMs,
                firstTextToCompletedMs:
                  firstTextMs === null ? null : completedElapsedMs - firstTextMs,
                elapsedMs: completedElapsedMs,
                finishReasons: Array.from(observedFinishReasons),
              });
              sentTerminalEvent = true;
              enqueue(
                encodeSseEvent('done', {
                  status: 'completed',
                  responseId: lastResponseId,
                  model: activeModel,
                  thinkingLevel: activeThinkingLevel,
                  apiMode: 'generateContentStream',
                  serverFirstTextMs: firstTextMs,
                  serverTotalMs: completedElapsedMs,
                  deltaCount: textDeltaCount,
                  progressive: textDeltaCount > 1,
                }),
              );
            } else {
              const isBlocked =
                Boolean(blockedReason) ||
                observedFinishReasons.has('SAFETY') ||
                observedFinishReasons.has('PROHIBITED_CONTENT') ||
                observedFinishReasons.has('BLOCKLIST') ||
                observedFinishReasons.has('RECITATION');

              const errorCode = isBlocked ? 'CONTENT_BLOCKED' : 'EMPTY_RESPONSE';
              const errorMessage = isBlocked
                ? 'Gemini blocked this response due to content safety policies.'
                : 'Gemini did not return any text content.';

              logChatStage('warn', 'gemini_stream_empty', {
                requestId,
                model: activeModel,
                apiMode: 'generateContentStream',
                blockedReason,
                finishReasons: Array.from(observedFinishReasons),
                totalChunks,
                thoughtChunkCount,
                elapsedMs: completedElapsedMs,
              });
              sentTerminalEvent = true;
              enqueue(
                encodeSseEvent('error', {
                  code: errorCode,
                  errorCategory: errorCode,
                  status: 502,
                  message: errorMessage,
                  model: activeModel,
                  serverTotalMs: completedElapsedMs,
                }),
              );
            }
          }
        } catch (error: unknown) {
          const activeTimeout =
            timeoutError ?? (error instanceof GeminiTimeoutError ? error : null);

          if (activeTimeout && !clientAborted && !isStreamClosed) {
            const mapped = mapSafeGeminiError(activeTimeout);
            const errorElapsedMs = Date.now() - startedAtMs;

            logChatStage('error', 'gemini_stream_timeout', {
              requestId,
              model: activeModel,
              apiMode: 'generateContentStream',
              timeoutStage: activeTimeout.timeoutStage,
              httpStatus: mapped.status,
              errorCategory: mapped.category,
              streamOpened,
              totalChunks,
              thoughtChunkCount,
              textDeltaCount,
              sanitizedMessage: sanitizeDiagnosticMessage(activeTimeout.message),
              elapsedMs: errorElapsedMs,
            });
            enqueue(
              encodeSseEvent('error', {
                code: mapped.code,
                errorCategory: mapped.category,
                status: mapped.status,
                message: mapped.message,
                model: activeModel,
                serverTotalMs: errorElapsedMs,
              }),
            );
          } else if (
            !isAbortError(error) &&
            !clientAborted &&
            !streamAbortController.signal.aborted &&
            !isStreamClosed
          ) {
            const diag = extractGeminiErrorDiagnostics(error);
            const mapped = mapSafeGeminiError(error);
            const errorElapsedMs = Date.now() - startedAtMs;

            logChatStage(
              'error',
              streamOpened ? 'gemini_stream_exception' : 'gemini_create_failed',
              {
                requestId,
                model: activeModel,
                apiMode: 'generateContentStream',
                upstreamStatus: diag.status,
                errorName: diag.name,
                errorCode: diag.code,
                sanitizedMessage: diag.sanitizedMessage,
                mappedStatus: mapped.status,
                mappedCode: mapped.code,
                errorCategory: mapped.category,
                elapsedMs: errorElapsedMs,
              },
            );
            enqueue(
              encodeSseEvent('error', {
                code: mapped.code,
                errorCategory: mapped.category,
                status: mapped.status,
                message: mapped.message,
                model: activeModel,
                serverTotalMs: errorElapsedMs,
              }),
            );
          } else {
            logChatStage('info', 'gemini_stream_aborted', {
              requestId,
              model: activeModel,
              apiMode: 'generateContentStream',
              elapsedMs: Date.now() - startedAtMs,
            });
          }
        } finally {
          clearInterval(keepaliveTimer);
          clearWatchdogs();
          request.signal.removeEventListener('abort', handleClientAbort);
          if (!isStreamClosed) {
            isStreamClosed = true;
            try {
              controller.close();
            } catch {
              // Stream already closed or cancelled
            }
          }
        }
      },
      cancel() {
        isStreamClosed = true;
        clientAborted = true;
        streamAbortController.abort();
        request.signal.removeEventListener('abort', handleClientAbort);
      },
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        'X-Klyvo-Request-Id': requestId,
      },
    });
  };
}

const handleChat = createChatHandler();
export default handleChat;
