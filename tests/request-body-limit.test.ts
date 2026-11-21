import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../server/handlers/chat';
import {
  ChatValidationError,
  MAX_CHAT_PAYLOAD_BYTES,
  parseAndValidateChatRequest,
} from '../server/lib/gemini';

function makeValidChatJsonOfExactByteSize(targetBytes: number): string {
  const base = JSON.stringify({
    messages: [{ role: 'user', content: 'Valid prompt' }],
  });
  const baseBytes = Buffer.byteLength(base, 'utf8');
  assert.ok(targetBytes >= baseBytes);
  // Pad valid JSON using trailing spaces before the final brace
  const padBytes = targetBytes - baseBytes;
  return `${base.slice(0, -1)}${' '.repeat(padBytes)}}`;
}

function makeChunkedStreamRequest(
  chunks: Uint8Array[],
  options?: {
    onPull?: (index: number) => void;
    onCancel?: (reason?: unknown) => void;
    omitContentLength?: boolean;
  },
): Request {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      options?.onPull?.(index);
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel(reason) {
      options?.onCancel?.(reason);
    },
  });

  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.omitContentLength ? {} : {}),
    },
    body: stream,
    duplex: 'half',
  };

  return new Request('http://localhost/api/chat', init);
}

test('parseAndValidateChatRequest accepts valid requests below and exactly at the 100 KB limit', async () => {
  const smallReq = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hello Klyvo!' }],
    }),
  });
  const smallParsed = await parseAndValidateChatRequest(smallReq);
  assert.deepEqual(smallParsed.messages, [
    { role: 'user', content: 'Hello Klyvo!' },
  ]);

  const exactPayload = makeValidChatJsonOfExactByteSize(MAX_CHAT_PAYLOAD_BYTES);
  assert.equal(Buffer.byteLength(exactPayload, 'utf8'), MAX_CHAT_PAYLOAD_BYTES);

  const enc = new TextEncoder();
  const exactBytes = enc.encode(exactPayload);
  const midpoint = Math.floor(exactBytes.byteLength / 2);
  const exactChunkedReq = makeChunkedStreamRequest([
    exactBytes.slice(0, midpoint),
    exactBytes.slice(midpoint),
  ]);

  const exactParsed = await parseAndValidateChatRequest(exactChunkedReq);
  assert.deepEqual(exactParsed.messages, [
    { role: 'user', content: 'Valid prompt' },
  ]);
});

test('parseAndValidateChatRequest rejects chunked requests without Content-Length exceeding 100 KB and cancels reader early', async () => {
  const enc = new TextEncoder();
  const chunkSize = 32 * 1024; // 32 KB per chunk -> 4th chunk hits 128 KB > 100 KB
  const chunks = Array.from({ length: 10 }, () =>
    enc.encode(' '.repeat(chunkSize)),
  );
  chunks[0] = enc.encode(
    `{"messages":[{"role":"user","content":"${'a'.repeat(chunkSize - 40)}`,
  );

  let pulledChunks = 0;
  let cancelled = false;

  const oversizedChunkedReq = makeChunkedStreamRequest(chunks, {
    omitContentLength: true,
    onPull: () => {
      pulledChunks += 1;
    },
    onCancel: () => {
      cancelled = true;
    },
  });

  assert.equal(oversizedChunkedReq.headers.get('content-length'), null);

  await assert.rejects(
    () => parseAndValidateChatRequest(oversizedChunkedReq),
    (err: unknown) =>
      err instanceof ChatValidationError &&
      err.status === 413 &&
      err.code === 'PAYLOAD_TOO_LARGE',
  );

  assert.equal(cancelled, true, 'Reader must be cancelled once 100 KB is exceeded');
  assert.ok(
    pulledChunks <= 5,
    `Expected early stream termination before pulling all 10 chunks, pulled ${pulledChunks}`,
  );
});

test('parseAndValidateChatRequest measures UTF-8 byte length accurately for multi-byte characters', async () => {
  // 26,000 4-byte emojis = 104,000 bytes (> 102,400 bytes) even though string length is < 102,400
  const enc = new TextEncoder();
  const emojis = '🚀'.repeat(26_000);
  const chunkBytes = enc.encode(
    `{"messages":[{"role":"user","content":"${emojis}"}]}`,
  );
  assert.ok(chunkBytes.byteLength > MAX_CHAT_PAYLOAD_BYTES);

  const half = Math.floor(chunkBytes.byteLength / 2);
  let cancelled = false;
  const req = makeChunkedStreamRequest(
    [chunkBytes.slice(0, half), chunkBytes.slice(half)],
    {
      onCancel: () => {
        cancelled = true;
      },
    },
  );

  await assert.rejects(
    () => parseAndValidateChatRequest(req),
    (err: unknown) =>
      err instanceof ChatValidationError &&
      err.status === 413 &&
      err.code === 'PAYLOAD_TOO_LARGE',
  );
  assert.equal(cancelled, true);
});

test('parseAndValidateChatRequest handles malformed JSON, empty bodies, missing bodies, and interrupted streams safely', async () => {
  // Malformed JSON
  const malformedReq = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"messages": [',
  });
  await assert.rejects(
    () => parseAndValidateChatRequest(malformedReq),
    (err: unknown) =>
      err instanceof ChatValidationError &&
      err.status === 400 &&
      err.code === 'MALFORMED_JSON',
  );

  // Empty body (missing body)
  const missingBodyReq = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(
    () => parseAndValidateChatRequest(missingBodyReq),
    (err: unknown) =>
      err instanceof ChatValidationError &&
      err.status === 400 &&
      err.code === 'EMPTY_REQUEST_BODY',
  );

  // Empty body (0-byte stream)
  const emptyStreamReq = makeChunkedStreamRequest([]);
  await assert.rejects(
    () => parseAndValidateChatRequest(emptyStreamReq),
    (err: unknown) =>
      err instanceof ChatValidationError &&
      err.status === 400 &&
      err.code === 'EMPTY_REQUEST_BODY',
  );

  // Interrupted stream error
  const erroredStream = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error('Connection reset by peer');
    },
  });
  const interruptedReq = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: erroredStream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  await assert.rejects(
    () => parseAndValidateChatRequest(interruptedReq),
    (err: unknown) =>
      err instanceof ChatValidationError &&
      err.status === 400 &&
      err.code === 'INVALID_REQUEST_BODY',
  );
});

test('chat handler returns HTTP 413 PAYLOAD_TOO_LARGE JSON response for oversized chunked requests', async () => {
  const handler = createChatHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({
      userId: 'user-size-limit',
      email: 'test@klyvo.app',
    }),
    checkUserRateLimit: () => ({
      allowed: true,
      limit: 20,
      remaining: 19,
      retryAfterSeconds: 0,
    }),
  });

  const enc = new TextEncoder();
  const largeChunk = enc.encode('x'.repeat(60 * 1024));
  const oversizedReq = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-jwt',
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(largeChunk);
        controller.enqueue(largeChunk);
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  const response = await handler(oversizedReq);
  assert.equal(response.status, 413);
  const body = (await response.json()) as { error: string; code: string };
  assert.equal(body.code, 'PAYLOAD_TOO_LARGE');
});
