import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { Modality, type CreateAuthTokenParameters } from '@google/genai';
import express from 'express';
import { createVoiceTokenHandler } from '../server/handlers/voice-token';
import { AuthVerificationError } from '../server/lib/auth';
import {
  createGeminiLiveServerClient,
  DEFAULT_GEMINI_LIVE_MODEL,
  GEMINI_LIVE_API_VERSION,
  mapSafeVoiceTokenError,
  mintGeminiLiveEphemeralToken,
} from '../server/lib/geminiLive';
import { checkUserRateLimit } from '../server/lib/rateLimit';
import { toExpressHandler } from '../server/webAdapter';

async function startTestExpressServer(
  handler: (req: Request) => Promise<Response>,
) {
  const app = express();
  app.all('/api/voice-token', toExpressHandler(handler));

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test('voice-token handles OPTIONS 204 and rejects non-POST methods with 405', async () => {
  const handler = createVoiceTokenHandler();

  const optRes = await handler(
    new Request('http://localhost/api/voice-token', { method: 'OPTIONS' }),
  );
  assert.equal(optRes.status, 204);
  assert.equal(optRes.headers.get('allow'), 'POST, OPTIONS');

  const getRes = await handler(
    new Request('http://localhost/api/voice-token', { method: 'GET' }),
  );
  assert.equal(getRes.status, 405);
  assert.equal(getRes.headers.get('allow'), 'POST, OPTIONS');
  const getBody = (await getRes.json()) as { code: string };
  assert.equal(getBody.code, 'METHOD_NOT_ALLOWED');
});

test('voice-token rejects missing or invalid Supabase JWT with 401', async () => {
  const handler = createVoiceTokenHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => {
      throw new AuthVerificationError(
        'Invalid or expired authentication session.',
        401,
        'INVALID_ACCESS_TOKEN',
      );
    },
  });

  const missingRes = await handler(
    new Request('http://localhost/api/voice-token', { method: 'POST' }),
  );
  assert.equal(missingRes.status, 401);
  assert.equal(
    ((await missingRes.json()) as { code: string }).code,
    'MISSING_ACCESS_TOKEN',
  );

  const invalidRes = await handler(
    new Request('http://localhost/api/voice-token', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad.jwt.token' },
    }),
  );
  assert.equal(invalidRes.status, 401);
  assert.equal(
    ((await invalidRes.json()) as { code: string }).code,
    'INVALID_ACCESS_TOKEN',
  );
});

test('voice-token enforces dedicated per-user voice rate limit namespace', async () => {
  const seenKeys: string[] = [];
  const handler = createVoiceTokenHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({
      userId: 'user-voice-rl-123',
      email: 'test@example.com',
    }),
    checkUserRateLimit: (key: string) => {
      seenKeys.push(key);
      return {
        allowed: false,
        limit: 20,
        remaining: 0,
        retryAfterSeconds: 42,
      };
    },
  });

  const res = await handler(
    new Request('http://localhost/api/voice-token', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.jwt.token' },
    }),
  );
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '42');
  assert.equal(seenKeys[0], 'voice:user-voice-rl-123');
  assert.equal(((await res.json()) as { code: string }).code, 'RATE_LIMITED');

  // Verify real rateLimit bucket isolation between chat user key and voice:user key
  const chatResult = checkUserRateLimit('isolated-user-abc');
  const voiceResult = checkUserRateLimit('voice:isolated-user-abc');
  assert.equal(chatResult.allowed, true);
  assert.equal(voiceResult.allowed, true);
  assert.equal(chatResult.remaining, chatResult.limit - 1);
  assert.equal(voiceResult.remaining, voiceResult.limit - 1);
});

test('mintGeminiLiveEphemeralToken creates v1alpha ephemeral token locked to Live model and AUDIO', async () => {
  const capturedCalls: CreateAuthTokenParameters[] = [];
  const fixedNowMs = Date.parse('2026-11-20T12:00:00.000Z');

  const result = await mintGeminiLiveEphemeralToken({
    nowMs: fixedNowMs,
    client: {
      authTokens: {
        create: async (params) => {
          capturedCalls.push(params);
          return { name: 'auth_tokens/mock-ephemeral-12345' };
        },
      },
    },
  });

  assert.equal(capturedCalls.length, 1);
  const cfg = capturedCalls[0]?.config;
  assert.equal(cfg?.uses, 1);
  assert.equal(cfg?.newSessionExpireTime, '2026-11-20T12:01:00.000Z');
  assert.equal(cfg?.expireTime, '2026-11-20T12:30:00.000Z');
  assert.equal(cfg?.liveConnectConstraints?.model, DEFAULT_GEMINI_LIVE_MODEL);
  assert.deepEqual(cfg?.liveConnectConstraints?.config?.responseModalities, [
    Modality.AUDIO,
  ]);
  assert.deepEqual(cfg?.lockAdditionalFields, []);

  assert.equal(result.token, 'auth_tokens/mock-ephemeral-12345');
  assert.equal(result.model, DEFAULT_GEMINI_LIVE_MODEL);
  assert.equal(result.apiVersion, GEMINI_LIVE_API_VERSION);
  assert.equal(result.uses, 1);
});

test('createGeminiLiveServerClient reads GEMINI_API_KEY fresh from env with v1alpha', () => {
  const prevKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = 'AIzaSyTestKeyValueOne';
    const client1 = createGeminiLiveServerClient();
    const apiClient1 = (
      client1 as unknown as {
        apiClient: { getApiVersion: () => string; getApiKey: () => string };
      }
    ).apiClient;
    assert.equal(apiClient1.getApiVersion(), 'v1alpha');
    assert.equal(apiClient1.getApiKey(), 'AIzaSyTestKeyValueOne');

    process.env.GEMINI_API_KEY = 'AIzaSyTestKeyValueTwo';
    const client2 = createGeminiLiveServerClient();
    const apiClient2 = (
      client2 as unknown as {
        apiClient: { getApiVersion: () => string; getApiKey: () => string };
      }
    ).apiClient;
    assert.equal(apiClient2.getApiVersion(), 'v1alpha');
    assert.equal(apiClient2.getApiKey(), 'AIzaSyTestKeyValueTwo');
  } finally {
    if (prevKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = prevKey;
    }
  }
});

test('POST /api/voice-token over Express returns ephemeral token with no-store and zero secret exposure', async () => {
  const secretSentinel = 'AIzaSyDO_NOT_LEAK_THIS_KEY_999';
  const handler = createVoiceTokenHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({
      userId: 'user-voice-success-1',
      email: 'voice@example.com',
    }),
    checkUserRateLimit: () => ({
      allowed: true,
      limit: 20,
      remaining: 19,
      retryAfterSeconds: 0,
    }),
    mintGeminiLiveEphemeralToken: async () => ({
      token: 'auth_tokens/live-ephemeral-token-abc',
      model: DEFAULT_GEMINI_LIVE_MODEL,
      apiVersion: 'v1alpha',
      expireTime: '2026-11-20T12:30:00.000Z',
      newSessionExpireTime: '2026-11-20T12:01:00.000Z',
      uses: 1,
    }),
  });

  const srv = await startTestExpressServer(handler);
  try {
    const res = await fetch(`${srv.baseUrl}/api/voice-token`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.supabase.jwt' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const rawText = await res.text();
    assert.equal(rawText.includes(secretSentinel), false);
    assert.equal(rawText.includes('AIza'), false);

    const parsed = JSON.parse(rawText) as {
      token: string;
      model: string;
      apiVersion: string;
      expireTime: string;
      newSessionExpireTime: string;
      uses: number;
    };
    assert.equal(parsed.token, 'auth_tokens/live-ephemeral-token-abc');
    assert.equal(parsed.model, 'gemini-3.8-live');
    assert.equal(parsed.apiVersion, 'v1alpha');
    assert.equal(parsed.uses, 1);
  } finally {
    await srv.close();
  }
});

test('voice-token sanitizes upstream errors and never exposes API keys', async () => {
  const mappedQuota = mapSafeVoiceTokenError({
    status: 429,
    message: 'Quota exceeded for AIzaSySecretKeyLeakTest123456',
  });
  assert.equal(mappedQuota.status, 429);
  assert.equal(mappedQuota.code, 'GEMINI_LIVE_QUOTA_EXCEEDED');
  assert.equal(mappedQuota.message.includes('AIza'), false);

  const handler = createVoiceTokenHandler({
    isServerSupabaseAuthConfigured: () => true,
    isGeminiConfigured: () => true,
    verifySupabaseRequestAuth: async () => ({
      userId: 'user-voice-err-1',
      email: null,
    }),
    checkUserRateLimit: () => ({
      allowed: true,
      limit: 20,
      remaining: 19,
      retryAfterSeconds: 0,
    }),
    mintGeminiLiveEphemeralToken: async () => {
      throw Object.assign(new Error('Permission denied for key AIzaSySecretValue12345'), {
        status: 403,
      });
    },
  });

  const res = await handler(
    new Request('http://localhost/api/voice-token', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.jwt' },
    }),
  );
  assert.equal(res.status, 403);
  const raw = await res.text();
  assert.equal(raw.includes('AIza'), false);
  assert.equal((JSON.parse(raw) as { code: string }).code, 'GEMINI_LIVE_PERMISSION_DENIED');
});
