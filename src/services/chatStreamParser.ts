export interface ChatApiTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatStreamEvent =
  | {
      type: 'meta';
      model: string;
      thinkingLevel: string;
      apiMode: string;
      requestStartedAt?: string;
      serverPreflightMs?: number;
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      status: string;
      responseId?: string;
      interactionId?: string;
      model?: string;
      thinkingLevel?: string;
      apiMode?: string;
      serverFirstTextMs?: number | null;
      serverTotalMs?: number | null;
      deltaCount?: number;
      progressive?: boolean;
    }
  | {
      type: 'error';
      code: string;
      errorCategory?: string;
      statusCode?: number;
      message: string;
    };

export type ParsedChatStreamEvent = ChatStreamEvent & { statusCode?: number };

export interface StreamGeminiChatResult {
  completed: boolean;
  aborted: boolean;
  responseId?: string;
  interactionId?: string;
  model?: string;
  thinkingLevel?: string;
  apiMode?: string;
  firstServerResponseMs?: number;
  serverFirstTextMs?: number | null;
  firstClientDeltaMs?: number | null;
  totalMs?: number;
  deltaCount?: number;
  progressive?: boolean;
}

export class ChatApiError extends Error {
  status: number;
  code: string;
  category: string;

  constructor(
    message: string,
    status: number,
    code: string,
    category?: string,
  ) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.code = code;
    this.category = category || code;
  }
}

export const MAX_CLIENT_HISTORY_TURNS = 24;
export const MAX_CLIENT_HISTORY_CHARS = 32_000;

export function normalizeHistoryTurns(messages: ChatApiTurn[]): ChatApiTurn[] {
  const valid = messages
    .map((m) => ({
      role: m.role,
      content: m.content.trim(),
    }))
    .filter(
      (m): m is ChatApiTurn =>
        (m.role === 'user' || m.role === 'assistant') && m.content.length > 0,
    );

  if (valid.length <= 1) {
    return valid;
  }

  const selectedReversed: ChatApiTurn[] = [];
  let totalChars = 0;

  for (let i = valid.length - 1; i >= 0; i -= 1) {
    const turn = valid[i];
    const isLatest = i === valid.length - 1;
    if (!isLatest) {
      if (selectedReversed.length >= MAX_CLIENT_HISTORY_TURNS) break;
      if (totalChars + turn.content.length > MAX_CLIENT_HISTORY_CHARS) break;
    }
    selectedReversed.push(turn);
    totalChars += turn.content.length;
  }

  return selectedReversed.reverse();
}

export function getHttpErrorFallback(
  status: number,
  chatEndpointLabel = '/api/chat',
): { code: string; message: string } {
  switch (status) {
    case 401:
      return {
        code: 'UNAUTHORIZED',
        message: 'Your session is invalid or has expired. Please sign in again.',
      };
    case 404:
      return {
        code: 'API_ROUTE_UNAVAILABLE',
        message: `Chat endpoint (${chatEndpointLabel}) is unavailable. Ensure the Klyvo server is running.`,
      };
    case 413:
      return {
        code: 'PAYLOAD_TOO_LARGE',
        message:
          'This prompt or conversation history exceeds the maximum allowed request size.',
      };
    case 429:
      return {
        code: 'RATE_LIMITED',
        message:
          'Rate limit or Gemini API quota reached. Please wait a moment and try again.',
      };
    case 504:
      return {
        code: 'GEMINI_TIMEOUT',
        message: 'Gemini took too long to respond. Please try again.',
      };
    case 500:
    case 501:
    case 502:
    case 503:
      return {
        code: 'SERVER_ERROR',
        message:
          'The Gemini chat service encountered a server error. Please verify environment configuration and try again.',
      };
    default:
      return {
        code: `HTTP_${status}`,
        message: `Chat request failed with status ${status}.`,
      };
  }
}

export async function parseErrorResponse(
  response: Response,
  chatEndpointLabel = '/api/chat',
): Promise<ChatApiError> {
  const fallback = getHttpErrorFallback(response.status, chatEndpointLabel);
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as {
        error?: unknown;
        message?: unknown;
        code?: unknown;
        errorCategory?: unknown;
      };
      const serverMessage =
        typeof payload.error === 'string' && payload.error.trim()
          ? payload.error.trim()
          : typeof payload.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : fallback.message;
      const serverCode =
        typeof payload.code === 'string' && payload.code.trim()
          ? payload.code.trim()
          : fallback.code;
      const serverCategory =
        typeof payload.errorCategory === 'string' && payload.errorCategory.trim()
          ? payload.errorCategory.trim()
          : serverCode;

      return new ChatApiError(serverMessage, response.status, serverCode, serverCategory);
    } catch {
      return new ChatApiError(fallback.message, response.status, fallback.code);
    }
  }

  return new ChatApiError(fallback.message, response.status, fallback.code);
}

export function parseRawSseFrame(rawFrame: string): ParsedChatStreamEvent | null {
  const lines = rawFrame.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(':')) continue;

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      eventName = value.trim() || 'message';
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (eventName === 'meta') {
    return {
      type: 'meta',
      model: typeof parsed.model === 'string' ? parsed.model : 'unknown',
      thinkingLevel:
        typeof parsed.thinkingLevel === 'string' ? parsed.thinkingLevel : 'default',
      apiMode:
        typeof parsed.apiMode === 'string' ? parsed.apiMode : 'generateContentStream',
      requestStartedAt:
        typeof parsed.requestStartedAt === 'string' ? parsed.requestStartedAt : undefined,
      serverPreflightMs:
        typeof parsed.serverPreflightMs === 'number' ? parsed.serverPreflightMs : undefined,
    };
  }

  if (eventName === 'delta' && typeof parsed.text === 'string') {
    return { type: 'delta', text: parsed.text };
  }

  if (eventName === 'done') {
    return {
      type: 'done',
      status: typeof parsed.status === 'string' ? parsed.status : 'completed',
      responseId:
        typeof parsed.responseId === 'string' ? parsed.responseId : undefined,
      interactionId:
        typeof parsed.interactionId === 'string'
          ? parsed.interactionId
          : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      thinkingLevel:
        typeof parsed.thinkingLevel === 'string' ? parsed.thinkingLevel : undefined,
      apiMode: typeof parsed.apiMode === 'string' ? parsed.apiMode : undefined,
      serverFirstTextMs:
        typeof parsed.serverFirstTextMs === 'number'
          ? parsed.serverFirstTextMs
          : undefined,
      serverTotalMs:
        typeof parsed.serverTotalMs === 'number' ? parsed.serverTotalMs : undefined,
      deltaCount:
        typeof parsed.deltaCount === 'number' ? parsed.deltaCount : undefined,
      progressive:
        typeof parsed.progressive === 'boolean' ? parsed.progressive : undefined,
    };
  }

  if (eventName === 'error') {
    const code =
      typeof parsed.code === 'string' && parsed.code.trim()
        ? parsed.code.trim()
        : 'GEMINI_STREAM_ERROR';
    const errorCategory =
      typeof parsed.errorCategory === 'string' && parsed.errorCategory.trim()
        ? parsed.errorCategory.trim()
        : code;

    return {
      type: 'error',
      code,
      errorCategory,
      message:
        typeof parsed.message === 'string' && parsed.message.trim()
          ? parsed.message.trim()
          : 'Unable to complete the Gemini response.',
      statusCode: typeof parsed.status === 'number' ? parsed.status : 502,
    };
  }

  return null;
}

export function isChatAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

export async function consumeChatSseResponse(params: {
  response: Response;
  requestStartedMs?: number;
  chatEndpointLabel?: string;
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}): Promise<StreamGeminiChatResult> {
  const { response, signal, onEvent } = params;
  const requestStartedMs = params.requestStartedMs ?? Date.now();
  const requestId = response.headers.get('x-klyvo-request-id') || 'unknown';
  const headersReceivedMs = Date.now();
  const firstServerResponseMs = headersReceivedMs - requestStartedMs;

  console.info('[klyvo:sse]', {
    stage: 'client_fetch_headers',
    requestId,
    status: response.status,
    elapsedMs: firstServerResponseMs,
  });

  if (!response.ok) {
    throw await parseErrorResponse(response, params.chatEndpointLabel);
  }

  if (!response.body) {
    throw new ChatApiError(
      'Streaming response body is unavailable in this browser.',
      500,
      'STREAM_UNSUPPORTED',
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let receivedDone = false;
  let responseId: string | undefined;
  let interactionId: string | undefined;
  let model: string | undefined;
  let thinkingLevel: string | undefined;
  let apiMode: string | undefined;
  let serverFirstTextMs: number | null | undefined;
  let progressive: boolean | undefined;
  let chunkCount = 0;
  let deltaCount = 0;
  let totalDeltaChars = 0;
  let firstClientDeltaMs: number | null = null;
  let prevDeltaMs: number | null = null;

  const dispatchEvent = (event: ParsedChatStreamEvent) => {
    if (event.type === 'meta') {
      model = event.model;
      thinkingLevel = event.thinkingLevel;
      apiMode = event.apiMode;
    } else if (event.type === 'delta') {
      deltaCount += 1;
      totalDeltaChars += event.text.length;
      const nowMs = Date.now();
      const sincePrevDeltaMs = prevDeltaMs === null ? null : nowMs - prevDeltaMs;
      prevDeltaMs = nowMs;

      if (deltaCount === 1) {
        firstClientDeltaMs = nowMs - requestStartedMs;
        console.info('[klyvo:sse]', {
          stage: 'client_first_delta_event',
          requestId,
          chunkChars: event.text.length,
          elapsedMs: firstClientDeltaMs,
          sinceHeadersMs: nowMs - headersReceivedMs,
        });
      } else if (deltaCount <= 5 || deltaCount % 25 === 0) {
        console.info('[klyvo:sse]', {
          stage: 'client_delta_event',
          requestId,
          deltaIndex: deltaCount,
          chunkChars: event.text.length,
          elapsedMs: nowMs - requestStartedMs,
          sincePrevDeltaMs,
        });
      }
    }
    onEvent(event);
  };

  const processBuffer = (flushAll: boolean) => {
    if (!flushAll && buffer.endsWith('\r')) {
      const head = buffer.slice(0, -1).replace(/\r\n/g, '\n');
      buffer = `${head}\r`;
    } else {
      buffer = buffer.replace(/\r\n/g, '\n');
    }

    let delimiterIndex = buffer.indexOf('\n\n');
    while (delimiterIndex !== -1) {
      const rawFrame = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 2);

      const event = parseRawSseFrame(rawFrame);
      if (event) {
        if (event.type === 'error') {
          dispatchEvent(event);
          throw new ChatApiError(
            event.message,
            event.statusCode ?? 502,
            event.code,
            event.errorCategory,
          );
        }
        if (event.type === 'done') {
          receivedDone = true;
          responseId = event.responseId;
          interactionId = event.interactionId;
          if (event.model) model = event.model;
          if (event.thinkingLevel) thinkingLevel = event.thinkingLevel;
          if (event.apiMode) apiMode = event.apiMode;
          if (event.serverFirstTextMs !== undefined) {
            serverFirstTextMs = event.serverFirstTextMs;
          }
          if (event.progressive !== undefined) {
            progressive = event.progressive;
          }
        }
        dispatchEvent(event);
      }

      delimiterIndex = buffer.indexOf('\n\n');
    }

    if (flushAll && buffer.trim()) {
      const trailingEvent = parseRawSseFrame(buffer.trim());
      buffer = '';
      if (trailingEvent) {
        if (trailingEvent.type === 'error') {
          dispatchEvent(trailingEvent);
          throw new ChatApiError(
            trailingEvent.message,
            trailingEvent.statusCode ?? 502,
            trailingEvent.code,
            trailingEvent.errorCategory,
          );
        }
        if (trailingEvent.type === 'done') {
          receivedDone = true;
          responseId = trailingEvent.responseId;
          interactionId = trailingEvent.interactionId;
          if (trailingEvent.model) model = trailingEvent.model;
          if (trailingEvent.thinkingLevel) thinkingLevel = trailingEvent.thinkingLevel;
          if (trailingEvent.apiMode) apiMode = trailingEvent.apiMode;
          if (trailingEvent.serverFirstTextMs !== undefined) {
            serverFirstTextMs = trailingEvent.serverFirstTextMs;
          }
          if (trailingEvent.progressive !== undefined) {
            progressive = trailingEvent.progressive;
          }
        }
        dispatchEvent(trailingEvent);
      }
    }
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return { completed: false, aborted: true };
      }

      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        processBuffer(true);
        break;
      }

      if (value) {
        chunkCount += 1;
        if (chunkCount === 1) {
          const nowMs = Date.now();
          console.info('[klyvo:sse]', {
            stage: 'client_first_chunk',
            requestId,
            bytes: value.byteLength,
            elapsedMs: nowMs - requestStartedMs,
            sinceHeadersMs: nowMs - headersReceivedMs,
          });
        }
        buffer += decoder.decode(value, { stream: true });
        processBuffer(false);
      }
    }
  } catch (error: unknown) {
    if (error instanceof ChatApiError) {
      throw error;
    }
    if (isChatAbortError(error) || signal?.aborted) {
      return { completed: false, aborted: true };
    }
    throw new ChatApiError(
      'Connection interrupted while streaming the AI response.',
      502,
      'STREAM_INTERRUPTED',
      'STREAM_INTERRUPTED',
    );
  } finally {
    reader.releaseLock();
  }

  const finishedMs = Date.now();
  const totalMs = finishedMs - requestStartedMs;
  const computedProgressive =
    progressive ?? (deltaCount > 1 && firstClientDeltaMs !== null);

  console.info('[klyvo:sse]', {
    stage: 'client_stream_done',
    requestId,
    completed: receivedDone,
    totalChunks: chunkCount,
    deltaCount,
    totalChars: totalDeltaChars,
    elapsedMs: totalMs,
    sinceHeadersMs: finishedMs - headersReceivedMs,
  });

  return {
    completed: receivedDone,
    aborted: false,
    responseId,
    interactionId,
    model,
    thinkingLevel,
    apiMode,
    firstServerResponseMs,
    serverFirstTextMs,
    firstClientDeltaMs,
    totalMs,
    deltaCount,
    progressive: computedProgressive,
  };
}
