import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Modality,
  type LiveConnectParameters,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import {
  classifyMicrophoneError,
  decodeBase64Pcm16ToFloat32,
  DEFAULT_VOICE_MODEL,
  downsampleFloat32ToInt16Pcm,
  encodeInt16PcmToBase64,
  KlyvoVoiceEngine,
  requestVoiceEphemeralToken,
  VoiceServiceError,
  type VoiceAudioCaptureHandle,
  type VoiceAudioPlaybackHandle,
  type VoiceSessionState,
  type VoiceTranscriptEntry,
} from '../src/services/voiceService';

interface MockTrack {
  enabled: boolean;
  stopped: boolean;
  stop: () => void;
}

function createMockMediaStream() {
  const track: MockTrack = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;

  return { stream, track };
}

function createJsonFetchMock(
  handler: (input: string, init?: RequestInit) => { status: number; body: unknown },
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const result = handler(String(input), init);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function asServerMessage(partial: Partial<LiveServerMessage>): LiveServerMessage {
  return partial as LiveServerMessage;
}

test('PCM16 downsample, base64 encode, and decode round-trip', () => {
  // 48 kHz -> 16 kHz (3:1 downsample)
  const samples = new Float32Array(480);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000) * 0.5;
  }

  const downsampled = downsampleFloat32ToInt16Pcm(samples, 48_000, 16_000);
  assert.equal(downsampled.length, 160);

  const b64 = encodeInt16PcmToBase64(downsampled);
  assert.ok(b64.length > 0);

  const decoded = decodeBase64Pcm16ToFloat32(b64);
  assert.equal(decoded.length, 160);
  assert.ok(Math.abs(decoded[10] - downsampled[10] / 0x8000) < 0.001);
});

test('requestVoiceEphemeralToken handles success and sanitized error codes', async () => {
  let seenAuthHeader = '';
  let seenMethod = '';

  const tokenOk = await requestVoiceEphemeralToken({
    getAccessToken: async () => 'supabase-jwt-123',
    fetchImpl: createJsonFetchMock((url, init) => {
      assert.ok(url.endsWith('/voice-token'));
      seenMethod = init?.method ?? '';
      seenAuthHeader =
        (init?.headers as Record<string, string>)?.Authorization ?? '';
      return {
        status: 200,
        body: {
          token: 'auth_tokens/live-ephemeral-xyz',
          model: DEFAULT_VOICE_MODEL,
          apiVersion: 'v1alpha',
          expireTime: '2026-11-20T12:30:00.000Z',
          newSessionExpireTime: '2026-11-20T12:01:00.000Z',
          uses: 1,
        },
      };
    }),
  });

  assert.equal(seenMethod, 'POST');
  assert.equal(seenAuthHeader, 'Bearer supabase-jwt-123');
  assert.equal(tokenOk.token, 'auth_tokens/live-ephemeral-xyz');
  assert.equal(tokenOk.model, DEFAULT_VOICE_MODEL);
  assert.equal(tokenOk.apiVersion, 'v1alpha');

  await assert.rejects(
    () =>
      requestVoiceEphemeralToken({
        accessToken: 'expired-jwt',
        fetchImpl: createJsonFetchMock(() => ({
          status: 401,
          body: { error: 'Invalid session' },
        })),
      }),
    (err: unknown) =>
      err instanceof VoiceServiceError && err.code === 'UNAUTHENTICATED',
  );

  await assert.rejects(
    () =>
      requestVoiceEphemeralToken({
        accessToken: 'valid-jwt',
        fetchImpl: createJsonFetchMock(() => ({
          status: 429,
          body: { error: 'Too many requests', code: 'RATE_LIMITED' },
        })),
      }),
    (err: unknown) =>
      err instanceof VoiceServiceError && err.code === 'RATE_LIMITED',
  );

  await assert.rejects(
    () =>
      requestVoiceEphemeralToken({
        accessToken: 'valid-jwt',
        fetchImpl: createJsonFetchMock(() => ({
          status: 200,
          body: { token: '' },
        })),
      }),
    (err: unknown) =>
      err instanceof VoiceServiceError &&
      err.code === 'TOKEN_ERROR' &&
      err.status === 502,
  );

  await assert.rejects(
    () =>
      requestVoiceEphemeralToken({
        accessToken: 'valid-jwt',
        fetchImpl: (async () => {
          throw new TypeError('Failed to fetch');
        }) as typeof fetch,
      }),
    (err: unknown) =>
      err instanceof VoiceServiceError && err.code === 'TOKEN_ERROR',
  );
});

test('KlyvoVoiceEngine lifecycle transitions: idle -> requesting_permission -> connecting -> listening -> speaking -> listening -> idle', async () => {
  const states: VoiceSessionState[] = [];
  const { stream, track } = createMockMediaStream();

  let captureCloseCalls = 0;
  let playbackCloseCalls = 0;
  let sessionCloseCalls = 0;
  const hooks: { playbackStateCb?: (isPlaying: boolean) => void } = {};
  const enqueuedAudio: string[] = [];

  const mockSession = {
    sendRealtimeInput: () => {},
    close: () => {
      sessionCloseCalls += 1;
    },
  } as unknown as Session;

  const engine = new KlyvoVoiceEngine(
    {
      onStateChange: (s) => states.push(s),
    },
    {
      requestMicrophone: async () => stream,
      getAccessToken: async () => 'jwt-token',
      fetchImpl: createJsonFetchMock(() => ({
        status: 200,
        body: {
          token: 'auth_tokens/test-1',
          model: DEFAULT_VOICE_MODEL,
          apiVersion: 'v1alpha',
          expireTime: '',
          newSessionExpireTime: '',
          uses: 1,
        },
      })),
      createLiveSession: async ({ connectParams, apiVersion, model }) => {
        assert.equal(apiVersion, 'v1alpha');
        assert.equal(model, DEFAULT_VOICE_MODEL);
        assert.deepEqual(connectParams.config?.responseModalities, [Modality.AUDIO]);
        connectParams.callbacks.onopen?.();
        return mockSession;
      },
      createCapture: async (): Promise<VoiceAudioCaptureHandle> => ({
        setMuted: () => {},
        close: async () => {
          captureCloseCalls += 1;
        },
      }),
      createPlayback: ({ onPlaybackStateChange }): VoiceAudioPlaybackHandle => {
        hooks.playbackStateCb = onPlaybackStateChange;
        return {
          enqueuePcm24kBase64: (b64) => {
            enqueuedAudio.push(b64);
            hooks.playbackStateCb?.(true);
          },
          interrupt: () => {},
          close: async () => {
            playbackCloseCalls += 1;
          },
        };
      },
    },
  );

  assert.equal(engine.getSnapshot().state, 'idle');
  await engine.start();
  assert.equal(engine.getSnapshot().state, 'listening');

  // Calling start() again while active must be ignored
  await engine.start();

  // Assistant audio arrives -> triggers speaking -> playback ends -> listening
  engine.handleServerMessage(
    asServerMessage({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }],
        },
      },
    }),
  );
  assert.equal(enqueuedAudio.length, 1);
  assert.equal(engine.getSnapshot().state, 'speaking');

  hooks.playbackStateCb?.(false);
  assert.equal(engine.getSnapshot().state, 'listening');

  await engine.stop();
  assert.equal(engine.getSnapshot().state, 'idle');
  assert.equal(sessionCloseCalls, 1);
  assert.equal(captureCloseCalls, 1);
  assert.equal(playbackCloseCalls, 1);
  assert.equal(track.stopped, true);

  assert.deepEqual(states, [
    'requesting_permission',
    'connecting',
    'listening',
    'speaking',
    'listening',
    'idle',
  ]);
});

test('missing authentication cleans up mic stream and invokes onRequireAuth', async () => {
  const { stream, track } = createMockMediaStream();
  let requireAuthCalls = 0;
  const captured: { err?: VoiceServiceError } = {};
  let fetchCalled = false;

  const engine = new KlyvoVoiceEngine(
    {
      onRequireAuth: () => {
        requireAuthCalls += 1;
      },
      onError: (err) => {
        captured.err = err;
      },
    },
    {
      requestMicrophone: async () => stream,
      getAccessToken: async () => {
        throw new VoiceServiceError('Sign in required', 'UNAUTHENTICATED', {
          status: 401,
          recoverable: false,
        });
      },
      fetchImpl: (async () => {
        fetchCalled = true;
        return new Response('{}', { status: 500 });
      }) as typeof fetch,
    },
  );

  await engine.start();

  assert.equal(fetchCalled, false);
  assert.equal(track.stopped, true);
  assert.equal(requireAuthCalls, 1);
  assert.equal(engine.getSnapshot().state, 'error');
  assert.equal(captured.err?.code, 'UNAUTHENTICATED');
});

test('microphone permission denial produces clear guidance and skips token request', async () => {
  let tokenFetched = false;
  const captured: { err?: VoiceServiceError } = {};

  const permissionDenied = Object.assign(new Error('Permission denied'), {
    name: 'NotAllowedError',
  });
  assert.equal(classifyMicrophoneError(permissionDenied).code, 'PERMISSION_DENIED');

  const notFound = Object.assign(new Error('Requested device not found'), {
    name: 'NotFoundError',
  });
  assert.equal(classifyMicrophoneError(notFound).code, 'MICROPHONE_UNAVAILABLE');

  const engine = new KlyvoVoiceEngine(
    {
      onError: (err) => {
        captured.err = err;
      },
    },
    {
      requestMicrophone: async () => {
        throw permissionDenied;
      },
      fetchImpl: (async () => {
        tokenFetched = true;
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    },
  );

  await engine.start();

  assert.equal(tokenFetched, false);
  assert.equal(engine.getSnapshot().state, 'error');
  assert.equal(captured.err?.code, 'PERMISSION_DENIED');
  assert.ok(captured.err?.message.toLowerCase().includes('microphone'));
});

test('WebSocket connection failures (early close, rejection, and timeout) cleanly release resources', async () => {
  // 1. Early close before setupComplete completes
  {
    const { stream, track } = createMockMediaStream();
    let playbackClosed = 0;
    const captured: { err?: VoiceServiceError } = {};

    const engine = new KlyvoVoiceEngine(
      {
        onError: (e) => {
          captured.err = e;
        },
      },
      {
        requestMicrophone: async () => stream,
        getAccessToken: async () => 'jwt',
        fetchImpl: createJsonFetchMock(() => ({
          status: 200,
          body: { token: 'auth_tokens/t1', model: DEFAULT_VOICE_MODEL, apiVersion: 'v1alpha' },
        })),
        createPlayback: () => ({
          enqueuePcm24kBase64: () => {},
          interrupt: () => {},
          close: async () => {
            playbackClosed += 1;
          },
        }),
        createLiveSession: ({ connectParams }) =>
          new Promise<Session>(() => {
            setTimeout(() => {
              connectParams.callbacks.onclose?.({
                code: 4403,
                reason: 'Token expired',
              } as CloseEvent);
            }, 5);
          }),
      },
    );

    await engine.start();
    assert.equal(engine.getSnapshot().state, 'error');
    assert.equal(captured.err?.code, 'TOKEN_EXPIRED');
    assert.equal(track.stopped, true);
    assert.equal(playbackClosed, 1);
  }

  // 2. Connect timeout cleanly fails and releases mic
  {
    const { stream, track } = createMockMediaStream();
    const captured: { err?: VoiceServiceError } = {};

    const engine = new KlyvoVoiceEngine(
      {
        onError: (e) => {
          captured.err = e;
        },
      },
      {
        connectTimeoutMs: 25,
        requestMicrophone: async () => stream,
        getAccessToken: async () => 'jwt',
        fetchImpl: createJsonFetchMock(() => ({
          status: 200,
          body: { token: 'auth_tokens/t2', model: DEFAULT_VOICE_MODEL, apiVersion: 'v1alpha' },
        })),
        createPlayback: () => ({
          enqueuePcm24kBase64: () => {},
          interrupt: () => {},
          close: async () => {},
        }),
        createLiveSession: () => new Promise<Session>(() => {}),
      },
    );

    await engine.start();
    assert.equal(engine.getSnapshot().state, 'error');
    assert.equal(captured.err?.code, 'CONNECTION_ERROR');
    assert.equal(track.stopped, true);
  }
});

test('mute and unmute control track, audioStreamEnd, and chunk forwarding', async () => {
  const { stream, track } = createMockMediaStream();
  const hooks: { emitChunk?: (b64: string, level: number) => void } = {};
  let captureMuted = false;
  const sentInputs: unknown[] = [];

  const engine = new KlyvoVoiceEngine(
    {},
    {
      requestMicrophone: async () => stream,
      getAccessToken: async () => 'jwt',
      fetchImpl: createJsonFetchMock(() => ({
        status: 200,
        body: { token: 'auth_tokens/t3', model: DEFAULT_VOICE_MODEL, apiVersion: 'v1alpha' },
      })),
      createLiveSession: async ({ connectParams }) => {
        connectParams.callbacks.onopen?.();
        return {
          sendRealtimeInput: (payload: unknown) => {
            sentInputs.push(payload);
          },
          close: () => {},
        } as unknown as Session;
      },
      createCapture: async ({ onAudioChunk }) => {
        hooks.emitChunk = onAudioChunk;
        return {
          setMuted: (muted) => {
            captureMuted = muted;
            track.enabled = !muted;
          },
          close: async () => {},
        };
      },
      createPlayback: () => ({
        enqueuePcm24kBase64: () => {},
        interrupt: () => {},
        close: async () => {},
      }),
    },
  );

  await engine.start();

  // While unmuted, chunk is forwarded
  hooks.emitChunk?.('CHUNK_1', 0.42);
  assert.equal(sentInputs.length, 1);
  assert.equal(engine.getSnapshot().micLevel, 0.42);

  // Mute -> sends audioStreamEnd, stops forwarding audio, sets micLevel to 0
  const mutedNow = engine.toggleMute();
  assert.equal(mutedNow, true);
  assert.equal(captureMuted, true);
  assert.equal(track.enabled, false);
  assert.equal(engine.getSnapshot().micLevel, 0);
  assert.deepEqual(sentInputs[1], { audioStreamEnd: true });

  hooks.emitChunk?.('CHUNK_WHILE_MUTED', 0.9);
  assert.equal(sentInputs.length, 2);

  // Unmute -> resumes forwarding chunks
  const mutedAfter = engine.toggleMute();
  assert.equal(mutedAfter, false);
  assert.equal(track.enabled, true);
  hooks.emitChunk?.('CHUNK_2', 0.35);
  assert.equal(sentInputs.length, 3);

  await engine.dispose();
});

test('interruption immediately halts audio playback, finalizes assistant turn, and transitions to listening', async () => {
  const { stream } = createMockMediaStream();
  let playbackInterrupted = 0;
  const hooks: { playbackStateCb?: (isPlaying: boolean) => void } = {};
  let latestTranscripts: VoiceTranscriptEntry[] = [];

  const engine = new KlyvoVoiceEngine(
    {
      onTranscriptsChange: (t) => {
        latestTranscripts = t;
      },
    },
    {
      requestMicrophone: async () => stream,
      getAccessToken: async () => 'jwt',
      fetchImpl: createJsonFetchMock(() => ({
        status: 200,
        body: { token: 'auth_tokens/t4', model: DEFAULT_VOICE_MODEL, apiVersion: 'v1alpha' },
      })),
      createLiveSession: async ({ connectParams }) => {
        connectParams.callbacks.onopen?.();
        return {
          sendRealtimeInput: () => {},
          close: () => {},
        } as unknown as Session;
      },
      createCapture: async () => ({
        setMuted: () => {},
        close: async () => {},
      }),
      createPlayback: ({ onPlaybackStateChange }) => {
        hooks.playbackStateCb = onPlaybackStateChange;
        return {
          enqueuePcm24kBase64: () => hooks.playbackStateCb?.(true),
          interrupt: () => {
            playbackInterrupted += 1;
          },
          close: async () => {},
        };
      },
    },
  );

  await engine.start();

  // Interim user transcription then confirmed input transcription
  engine.handleServerMessage(
    asServerMessage({
      serverContent: { interimInputTranscription: { text: 'Hel' } },
    }),
  );
  engine.handleServerMessage(
    asServerMessage({
      serverContent: { inputTranscription: { text: 'Hello Klyvo' } },
    }),
  );
  assert.equal(latestTranscripts[0]?.speaker, 'user');
  assert.equal(latestTranscripts[0]?.text, 'Hello Klyvo');

  // Assistant starts speaking + output transcription
  engine.handleServerMessage(
    asServerMessage({
      serverContent: {
        outputTranscription: { text: 'Hi there, how can I' },
        modelTurn: {
          parts: [{ inlineData: { data: 'BBBB', mimeType: 'audio/pcm;rate=24000' } }],
        },
      },
    }),
  );
  assert.equal(engine.getSnapshot().state, 'speaking');
  assert.equal(latestTranscripts[0]?.isFinal, true);
  assert.equal(latestTranscripts[1]?.speaker, 'assistant');
  assert.equal(latestTranscripts[1]?.isFinal, false);

  // User interrupts mid-speech
  engine.handleServerMessage(
    asServerMessage({
      serverContent: { interrupted: true },
    }),
  );
  assert.equal(playbackInterrupted, 1);
  assert.equal(engine.getSnapshot().state, 'listening');
  assert.equal(latestTranscripts[1]?.isFinal, true);

  await engine.dispose();
});

test('reconnection on goAway and unexpected close requests fresh token and preserves transcripts', async () => {
  const { stream, track } = createMockMediaStream();
  const states: VoiceSessionState[] = [];
  let tokenCounter = 0;
  const hooks: { activeCallbacks?: LiveConnectParameters['callbacks'] } = {};
  let captureCreateCalls = 0;
  let failNextConnect = false;

  const engine = new KlyvoVoiceEngine(
    { onStateChange: (s) => states.push(s) },
    {
      reconnectDelayMs: 10,
      maxReconnectAttempts: 1,
      requestMicrophone: async () => stream,
      getAccessToken: async () => 'jwt',
      fetchImpl: createJsonFetchMock(() => {
        tokenCounter += 1;
        return {
          status: 200,
          body: {
            token: `auth_tokens/reconnect-${tokenCounter}`,
            model: DEFAULT_VOICE_MODEL,
            apiVersion: 'v1alpha',
          },
        };
      }),
      createLiveSession: async ({ connectParams }) => {
        if (failNextConnect) {
          throw new VoiceServiceError('Upstream unavailable', 'CONNECTION_ERROR', {
            recoverable: true,
          });
        }
        hooks.activeCallbacks = connectParams.callbacks;
        connectParams.callbacks.onopen?.();
        return {
          sendRealtimeInput: () => {},
          close: () => {},
        } as unknown as Session;
      },
      createCapture: async () => {
        captureCreateCalls += 1;
        return {
          setMuted: () => {},
          close: async () => {},
        };
      },
      createPlayback: () => ({
        enqueuePcm24kBase64: () => {},
        interrupt: () => {},
        close: async () => {},
      }),
    },
  );

  await engine.start();
  assert.equal(tokenCounter, 1);
  assert.equal(captureCreateCalls, 1);

  engine.handleServerMessage(
    asServerMessage({
      serverContent: {
        outputTranscription: { text: 'Initial message' },
        turnComplete: true,
      },
    }),
  );

  // Trigger unexpected close (non-1000)
  hooks.activeCallbacks?.onclose?.({ code: 1006, reason: 'Abnormal closure' } as CloseEvent);
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(tokenCounter, 2);
  assert.equal(captureCreateCalls, 1); // Mic capture preserved across reconnect
  assert.equal(track.stopped, false);
  assert.equal(engine.getSnapshot().state, 'listening');
  assert.equal(engine.getSnapshot().transcripts.length, 1);
  assert.ok(states.includes('reconnecting'));

  // Trigger goAway -> proactively reconnects for new token
  engine.handleServerMessage(asServerMessage({ goAway: { timeLeft: '5s' } }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(tokenCounter, 3);
  assert.equal(engine.getSnapshot().state, 'listening');

  // If reconnection fails on unexpected close -> error state & mic released
  failNextConnect = true;
  hooks.activeCallbacks?.onclose?.({ code: 1006, reason: 'Network drop' } as CloseEvent);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(engine.getSnapshot().state, 'error');
  assert.equal(track.stopped, true);

  await engine.dispose();
});

test('dispose stops tracks and suppresses any further state emissions', async () => {
  const { stream, track } = createMockMediaStream();
  const states: VoiceSessionState[] = [];
  let sessionClosed = 0;

  const engine = new KlyvoVoiceEngine(
    { onStateChange: (s) => states.push(s) },
    {
      requestMicrophone: async () => stream,
      getAccessToken: async () => 'jwt',
      fetchImpl: createJsonFetchMock(() => ({
        status: 200,
        body: { token: 'auth_tokens/dispose-1', model: DEFAULT_VOICE_MODEL, apiVersion: 'v1alpha' },
      })),
      createLiveSession: async ({ connectParams }) => {
        connectParams.callbacks.onopen?.();
        return {
          sendRealtimeInput: () => {},
          close: () => {
            sessionClosed += 1;
          },
        } as unknown as Session;
      },
      createCapture: async () => ({
        setMuted: () => {},
        close: async () => {},
      }),
      createPlayback: () => ({
        enqueuePcm24kBase64: () => {},
        interrupt: () => {},
        close: async () => {},
      }),
    },
  );

  await engine.start();
  const countBeforeDispose = states.length;
  await engine.dispose();

  assert.equal(sessionClosed, 1);
  assert.equal(track.stopped, true);

  // Attempting to use or emit after dispose is a safe no-op
  engine.handleServerMessage(
    asServerMessage({
      serverContent: { outputTranscription: { text: 'late message' } },
    }),
  );
  engine.setMuted(true);
  await engine.stop();
  assert.equal(states.length, countBeforeDispose);
});
