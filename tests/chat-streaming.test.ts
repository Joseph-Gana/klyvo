import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import express from 'express';
import { createChatHandler } from '../server/handlers/chat';
import handleHealth from '../server/handlers/health';
import { AuthVerificationError } from '../server/lib/auth';
import {
  buildGenerateContentContents,
  createGeminiClient,
  createKlyvoChatStream,
  GeminiTimeoutError,
  getConfiguredGeminiModel,
  getConfiguredThinkingLevel,
  trimInteractionTurns,
  type ChatModelsClientLike,
} from '../server/lib/gemini';
import { checkUserRateLimit } from '../server/lib/rateLimit';
import { toExpressHandler } from '../server/webAdapter';
import {
  ChatApiError,
  consumeChatSseResponse,
  normalizeHistoryTurns,
  parseRawSseFrame,
  type ChatStreamEvent,
} from '../src/services/chatStreamParser';
import { parseMarkdownBlocks } from '../src/utils/markdownParser';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeTextChunk(
  text: string,
  options?: { responseId?: string; finishReason?: string },
): GenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
        ...(options?.finishReason ? { finishReason: options.finishReason } : {}),
      },
    ],
    ...(options?.responseId ? { responseId: options.responseId } : {}),
  } as unknown as GenerateContentResponse;
}

function makeThoughtChunk(thoughtText = 'reasoning...'): GenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: thoughtText, thought: true }],
        },
      },
    ],
  } as unknown as GenerateContentResponse;
}

async function startTestExpressServer(handler: (req: Request) => Promise<Response>) {
  const app = express();
  app.all('/api/chat', toExpressHandler(handler));

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}

test('1. Gemini model configuration uses gemini-3.5-flash-lite + generateContentStream with ThinkingLevel.MINIMAL and fresh env API key reading', async () => {
  const model = getConfiguredGeminiModel();
  assert.equal(model, 'gemini-3.5-flash-lite');
  assert.equal(getConfiguredThinkingLevel(model), ThinkingLevel.MINIMAL);
  assert.equal(getConfiguredThinkingLevel('gemini-3.1-flash-lite'), ThinkingLevel.MINIMAL);
  assert.equal(getConfiguredThinkingLevel('gemini-3.8-flash'), ThinkingLevel.LOW);

  const prevKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    assert.throws(() => createGeminiClient(), /not configured/i);

    process.env.GEMINI_API_KEY = 'test-key-one';
    const clientOne = createGeminiClient();
    process.env.GEMINI_API_KEY = 'test-key-two';
    const clientTwo = createGeminiClient();
    assert.notEqual(clientOne, clientTwo);
    assert.equal(
      (clientOne as unknown as { apiKey?: string }).apiKey,
      'test-key-one',
    );
    assert.equal(
      (clientTwo as unknown as { apiKey?: string }).apiKey,
      'test-key-two',
    );
  } finally {
    if (prevKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = prevKey;
    }
  }

  let capturedParams: Record<string, unknown> | undefined;

  const mockClient: ChatModelsClientLike = {
    models: {
      generateContentStream: (async (params: unknown) => {
        capturedParams = params as Record<string, unknown>;
        return (async function* () {
          yield makeTextChunk('Hi');
        })();
      }) as unknown as ChatModelsClientLike['models']['generateContentStream'],
    },
  };

  const streamResult = await createKlyvoChatStream({
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'What is 2+2?' },
    ],
    client: mockClient,
  });

  assert.equal(streamResult.model, 'gemini-3.5-flash-lite');
  assert.equal(streamResult.thinkingLevel, ThinkingLevel.MINIMAL);

  assert.equal(capturedParams?.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(capturedParams?.contents, [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi there!' }] },
    { role: 'user', parts: [{ text: 'What is 2+2?' }] },
  ]);

  const config = capturedParams?.config as Record<string, unknown>;
  assert.equal(typeof config?.systemInstruction, 'string');
  assert.deepEqual(config?.thinkingConfig, { thinkingLevel: ThinkingLevel.MINIMAL });
  assert.equal(config?.tools, undefined);
  assert.equal(config?.automaticContinuation, false);
  assert.ok(config?.abortSignal instanceof AbortSignal);
  assert.equal(config?.temperature, undefined);
  assert.equal(config?.topP, undefined);
  assert.equal(config?.topK, undefined);
});

test('1b. Same-model transient pre-stream error retries once; never switches models or retries 400/401/403/404/429', async () => {
  const modelsCalled: Array<{ model: unknown; thinkingLevel: unknown }> = [];
  const transient503Client: ChatModelsClientLike = {
    models: {
      generateContentStream: (async (params: unknown) => {
        const p = params as {
          model?: string;
          config?: { thinkingConfig?: { thinkingLevel?: unknown } };
        };
        modelsCalled.push({
          model: p.model,
          thinkingLevel: p.config?.thinkingConfig?.thinkingLevel,
        });
        if (modelsCalled.length === 1) {
          const err = new Error('503 UNAVAILABLE: temporary spike') as Error & { status?: number };
          err.status = 503;
          throw err;
        }
        return (async function* () {
          yield makeTextChunk('Same-model recovered!');
        })();
      }) as unknown as ChatModelsClientLike['models']['generateContentStream'],
    },
  };

  const retryRes = await createKlyvoChatStream({
    messages: [{ role: 'user', content: 'Hello' }],
    retryDelayMs: 5,
    client: transient503Client,
  });

  let retryText = '';
  for await (const chunk of retryRes.stream) {
    retryText += chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
  assert.deepEqual(modelsCalled, [
    { model: 'gemini-3.5-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL },
    { model: 'gemini-3.5-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL },
  ]);
  assert.equal(retryRes.model, 'gemini-3.5-flash-lite');
  assert.equal(retryText, 'Same-model recovered!');

  // Non-retryable errors: 400, 401, 403, 404, 429 never retry and never switch models
  for (const status of [400, 401, 403, 404, 429]) {
    let attempts = 0;
    const strictFailClient: ChatModelsClientLike = {
      models: {
        generateContentStream: (async () => {
          attempts += 1;
          const err = new Error(`HTTP ${status} failure`) as Error & { status?: number };
          err.status = status;
          throw err;
        }) as unknown as ChatModelsClientLike['models']['generateContentStream'],
      },
    };

    await assert.rejects(
      () =>
        createKlyvoChatStream({
          messages: [{ role: 'user', content: 'Hello' }],
          retryDelayMs: 5,
          client: strictFailClient,
        }),
      (err: unknown) =>
        err instanceof Error && err.message.includes(`HTTP ${status} failure`),
    );
    assert.equal(attempts, 1, `HTTP ${status} must never retry or switch models`);
  }
});

test('2-4. Progressive streaming end-to-end: no 2KB padding, thoughts excluded from answer text, Express flushes immediately', async () => {
  const mockHandler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({ userId: 'user-stream-1', email: 'test@klyvo.app' }),
    checkUserRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 }),
    createKlyvoChatStream: async () =>
      (async function* () {
        yield makeThoughtChunk('Internal thought must not leak');
        await delay(50);
        yield makeTextChunk('First ', { responseId: 'resp-123' });
        await delay(140);
        yield makeTextChunk('progressive ', { responseId: 'resp-123' });
        await delay(140);
        yield makeTextChunk('chunk!', { responseId: 'resp-123', finishReason: 'STOP' });
      })(),
  });

  const server = await startTestExpressServer(mockHandler);
  try {
    const startMs = Date.now();
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say hi' }],
      }),
    });

    const headersMs = Date.now() - startMs;
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('x-klyvo-request-id'));
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    assert.ok(headersMs < 150, `Expected immediate SSE headers, got ${headersMs}ms`);

    const eventTimings: Array<{ ms: number; event: ChatStreamEvent }> = [];
    let renderedText = '';

    const result = await consumeChatSseResponse({
      response,
      requestStartedMs: startMs,
      onEvent: (event) => {
        eventTimings.push({ ms: Date.now() - startMs, event });
        if (event.type === 'delta') {
          renderedText += event.text;
          const blocks = parseMarkdownBlocks(renderedText);
          assert.ok(blocks.length >= 1);
        }
      },
    });

    assert.equal(result.completed, true);
    assert.equal(result.aborted, false);
    assert.equal(result.responseId, 'resp-123');
    assert.equal(result.model, 'gemini-3.5-flash-lite');
    assert.equal(result.apiMode, 'generateContentStream');
    assert.equal(result.progressive, true);
    assert.equal(renderedText, 'First progressive chunk!');
    assert.ok(!renderedText.includes('Internal thought'));

    const metaEvent = eventTimings.find((e) => e.event.type === 'meta');
    const deltaEvents = eventTimings.filter((e) => e.event.type === 'delta');
    const doneEvent = eventTimings.find((e) => e.event.type === 'done');
    assert.ok(metaEvent);
    assert.equal(deltaEvents.length, 3);
    assert.ok(doneEvent);

    const firstDeltaToDoneGapMs = doneEvent.ms - deltaEvents[0].ms;
    assert.ok(
      firstDeltaToDoneGapMs >= 200,
      `Expected progressive delivery across >=200ms, got gap=${firstDeltaToDoneGapMs}ms`,
    );
  } finally {
    await server.close();
  }
});

test('3b. Handler does NOT emit 2KB artificial padding comments on stream open', async () => {
  const mockHandler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({ userId: 'user-pad-check', email: null }),
    checkUserRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 }),
    createKlyvoChatStream: async () =>
      (async function* () {
        yield makeTextChunk('Hi');
      })(),
  });

  const res = await mockHandler(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    }),
  );

  const rawText = await res.text();
  assert.ok(rawText.startsWith(': stream-open\n\n'));
  assert.ok(!rawText.includes(' '.repeat(1024)), 'Must not emit artificial 2KB SSE padding');
});

test('4b. Frontend SSE consumer handles split multi-byte UTF-8 emojis and split CRLF frame boundaries', async () => {
  const enc = new TextEncoder();
  const fullPayload = enc.encode(
    'event: delta\r\ndata: {"text":"Hello 🚀 world"}\r\n\r\nevent: done\r\ndata: {"status":"completed"}\r\n\r\n',
  );

  const rocketIndex = fullPayload.indexOf(0xf0);
  const crlfBoundary = fullPayload.indexOf(0x0d) + 3;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(fullPayload.slice(0, crlfBoundary));
      controller.enqueue(fullPayload.slice(crlfBoundary, rocketIndex + 2));
      controller.enqueue(fullPayload.slice(rocketIndex + 2));
      controller.close();
    },
  });

  const mockResponse = new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

  const events: ChatStreamEvent[] = [];
  const result = await consumeChatSseResponse({
    response: mockResponse,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.completed, true);
  assert.deepEqual(events[0], { type: 'delta', text: 'Hello 🚀 world' });
  assert.equal(events[1].type, 'done');
});

test('5. Stop Generation cancels the upstream Gemini AbortSignal immediately', async () => {
  let upstreamAborted = false;

  const mockHandler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({ userId: 'user-abort-1', email: null }),
    checkUserRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 }),
    createKlyvoChatStream: async ({ signal }) => {
      signal?.addEventListener('abort', () => {
        upstreamAborted = true;
      });
      return (async function* () {
        yield makeTextChunk('Start ');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      })();
    },
  });

  const server = await startTestExpressServer(mockHandler);
  try {
    const abortController = new AbortController();
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Write a long essay' }],
      }),
      signal: abortController.signal,
    });

    const received: ChatStreamEvent[] = [];
    const result = await consumeChatSseResponse({
      response,
      signal: abortController.signal,
      onEvent: (event) => {
        received.push(event);
        if (event.type === 'delta') {
          abortController.abort();
        }
      },
    });

    assert.equal(result.aborted, true);
    assert.ok(received.some((e) => e.type === 'delta'));
    await delay(50);
    assert.equal(upstreamAborted, true, 'Upstream Gemini AbortSignal must be aborted on Stop');
  } finally {
    await server.close();
  }
});

test('6. Timeouts distinguish connection, first-text-token, and upstream idle (reset on non-text chunks)', async () => {
  // 6a. Upstream connection error -> 502 GEMINI_CONNECTION_ERROR
  const connErrorHandler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({ userId: 'user-err-1', email: null }),
    checkUserRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 }),
    createKlyvoChatStream: async () => {
      const err = new Error('fetch failed');
      err.name = 'APIConnectionError';
      throw err;
    },
  });

  const res1 = await connErrorHandler(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    }),
  );

  await assert.rejects(
    () => consumeChatSseResponse({ response: res1, onEvent: () => undefined }),
    (err: unknown) =>
      err instanceof ChatApiError &&
      err.code === 'GEMINI_CONNECTION_ERROR' &&
      err.status === 502,
  );

  // 6b. Thought chunks reset idle timeout (each gap < 90ms idle), allowing slow first text up to firstTextTimeoutMs
  const nonTextResetHandler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({ userId: 'user-err-2', email: null }),
    checkUserRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 }),
    streamIdleTimeoutMs: 90,
    firstTextTimeoutMs: 300,
    keepaliveIntervalMs: 1_000,
    createKlyvoChatStream: async () =>
      (async function* () {
        yield makeThoughtChunk('t1');
        await delay(55);
        yield makeThoughtChunk('t2');
        await delay(55);
        yield makeTextChunk('Answer after thoughts');
      })(),
  });

  const resNonTextOk = await nonTextResetHandler(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    }),
  );

  let okText = '';
  const okResult = await consumeChatSseResponse({
    response: resNonTextOk,
    onEvent: (event) => {
      if (event.type === 'delta') okText += event.text;
    },
  });
  assert.equal(okResult.completed, true);
  assert.equal(okText, 'Answer after thoughts');

  // 6c. Stream continues emitting non-text thought chunks forever -> firstTextTimeoutMs fires GEMINI_FIRST_TEXT_TIMEOUT
  const firstTextTimeoutHandler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({ userId: 'user-err-3', email: null }),
    checkUserRateLimit: () => ({ allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 }),
    streamIdleTimeoutMs: 250,
    firstTextTimeoutMs: 90,
    keepaliveIntervalMs: 1_000,
    createKlyvoChatStream: async ({ signal }) =>
      (async function* () {
        yield makeThoughtChunk('t1');
        await delay(40);
        yield makeThoughtChunk('t2');
        await new Promise<void>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(signal.reason ?? new GeminiTimeoutError('first text timeout', 'first_text'));
          });
        });
      })(),
  });

  const resFirstTextTimeout = await firstTextTimeoutHandler(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    }),
  );

  await assert.rejects(
    () => consumeChatSseResponse({ response: resFirstTextTimeout, onEvent: () => undefined }),
    (err: unknown) =>
      err instanceof ChatApiError &&
      err.code === 'GEMINI_TIMEOUT' &&
      err.category === 'GEMINI_FIRST_TEXT_TIMEOUT' &&
      err.status === 504,
  );
});

test('7. Invalid or missing authentication returns HTTP 401', async () => {
  const handler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => {
      throw new AuthVerificationError('Invalid token', 401, 'INVALID_ACCESS_TOKEN');
    },
  });

  const missingTokenRes = await handler(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    }),
  );
  assert.equal(missingTokenRes.status, 401);
  assert.equal((await missingTokenRes.json()).code, 'MISSING_ACCESS_TOKEN');

  const badTokenRes = await handler(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-jwt',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    }),
  );
  assert.equal(badTokenRes.status, 401);
  assert.equal((await badTokenRes.json()).code, 'INVALID_ACCESS_TOKEN');
});

test('8. Rate limiting blocks excessive bursts with HTTP 429 and Retry-After', async () => {
  const prevLimit = process.env.KLYVO_MAX_REQUESTS_PER_MINUTE;
  process.env.KLYVO_MAX_REQUESTS_PER_MINUTE = '2';

  try {
    const userId = `rate-test-${Date.now()}`;
    assert.equal(checkUserRateLimit(userId).allowed, true);
    assert.equal(checkUserRateLimit(userId).allowed, true);
    const blocked = checkUserRateLimit(userId);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds >= 1);

    const handler = createChatHandler({
      isServerSupabaseAuthConfigured: () => true,
      isGeminiConfigured: () => true,
      verifySupabaseRequestAuth: async () => ({ userId, email: null }),
    });

    const res = await handler(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );

    assert.equal(res.status, 429);
    assert.ok(res.headers.get('Retry-After'));
    assert.equal((await res.json()).code, 'RATE_LIMITED');
  } finally {
    if (prevLimit === undefined) {
      delete process.env.KLYVO_MAX_REQUESTS_PER_MINUTE;
    } else {
      process.env.KLYVO_MAX_REQUESTS_PER_MINUTE = prevLimit;
    }
  }
});

test('10. History budgeting, Content conversion, and SSE meta/delta parsing invariants hold', () => {
  const longHistory = Array.from({ length: 34 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Turn ${i + 1}: ${'x'.repeat(2_000)}`,
  }));
  longHistory.push({ role: 'user', content: 'Final user question' });

  const clientTrimmed = normalizeHistoryTurns(longHistory);
  assert.ok(clientTrimmed.length <= 24);
  assert.equal(clientTrimmed[clientTrimmed.length - 1].content, 'Final user question');

  const serverTrimmed = trimInteractionTurns(longHistory);
  assert.ok(serverTrimmed.length <= 24);
  assert.equal(serverTrimmed[serverTrimmed.length - 1].content, 'Final user question');

  const contents = buildGenerateContentContents([
    { role: 'user', content: 'U1' },
    { role: 'user', content: 'U2' },
    { role: 'assistant', content: 'A1' },
  ]);
  assert.deepEqual(contents, [
    { role: 'user', parts: [{ text: 'U1\n\nU2' }] },
    { role: 'model', parts: [{ text: 'A1' }] },
  ]);

  const metaFrame = parseRawSseFrame(
    'event: meta\ndata: {"model":"gemini-3.5-flash-lite","thinkingLevel":"MINIMAL","apiMode":"generateContentStream"}',
  );
  assert.deepEqual(metaFrame, {
    type: 'meta',
    model: 'gemini-3.5-flash-lite',
    thinkingLevel: 'MINIMAL',
    apiMode: 'generateContentStream',
    requestStartedAt: undefined,
    serverPreflightMs: undefined,
  });

  const errorFrame = parseRawSseFrame(
    'event: error\ndata: {"code":"GEMINI_QUOTA_EXCEEDED","errorCategory":"GEMINI_QUOTA_EXCEEDED","status":429,"message":"Quota reached"}',
  );
  assert.deepEqual(errorFrame, {
    type: 'error',
    code: 'GEMINI_QUOTA_EXCEEDED',
    errorCategory: 'GEMINI_QUOTA_EXCEEDED',
    statusCode: 429,
    message: 'Quota reached',
  });

  const assistantFrame = parseRawSseFrame('event: delta\ndata: {"text":"Persisted answer"}');
  assert.deepEqual(assistantFrame, { type: 'delta', text: 'Persisted answer' });
});

test('11. /api/health reports chat readiness cleanly without requiring image-generation configuration', async () => {
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevSupaUrl = process.env.SUPABASE_URL;
  const prevSupaKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  process.env.GEMINI_API_KEY = 'health-check-gemini-key';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'health-check-supa-key';

  try {
    const res = await handleHealth(new Request('http://localhost/api/health', { method: 'GET' }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      service: string;
      ready: Record<string, unknown>;
      config: Record<string, unknown>;
    };
    assert.equal(body.service, 'klyvo-api');
    assert.deepEqual(body.ready, {
      gemini: true,
      supabase: true,
      chat: true,
    });
    assert.deepEqual(body.config, {
      model: 'gemini-3.5-flash-lite',
      thinkingLevel: 'MINIMAL',
      apiMode: 'generateContentStream',
    });
  } finally {
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
    if (prevSupaUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevSupaUrl;
    if (prevSupaKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = prevSupaKey;
  }
});
