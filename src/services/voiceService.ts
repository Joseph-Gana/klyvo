import {
  GoogleGenAI,
  Modality,
  type LiveConnectParameters,
  type LiveServerMessage,
  type Session,
} from '@google/genai';

export type VoiceSessionState =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'reconnecting'
  | 'error';

export type VoiceTranscriptSpeaker = 'user' | 'assistant';

export interface VoiceTranscriptEntry {
  id: string;
  speaker: VoiceTranscriptSpeaker;
  text: string;
  isFinal: boolean;
  timestamp: string;
}

export interface VoiceTokenResponse {
  token: string;
  model: string;
  apiVersion: 'v1alpha';
  expireTime: string;
  newSessionExpireTime: string;
  uses: number;
}

export type VoiceErrorCode =
  | 'UNAUTHENTICATED'
  | 'SUPABASE_NOT_CONFIGURED'
  | 'PERMISSION_DENIED'
  | 'MICROPHONE_UNAVAILABLE'
  | 'AUDIO_UNSUPPORTED'
  | 'TOKEN_ERROR'
  | 'RATE_LIMITED'
  | 'CONNECTION_ERROR'
  | 'TOKEN_EXPIRED'
  | 'UNKNOWN_ERROR';

export class VoiceServiceError extends Error {
  code: VoiceErrorCode;
  status?: number;
  recoverable: boolean;

  constructor(
    message: string,
    code: VoiceErrorCode,
    options?: { status?: number; recoverable?: boolean },
  ) {
    super(message);
    this.name = 'VoiceServiceError';
    this.code = code;
    this.status = options?.status;
    this.recoverable = options?.recoverable ?? true;
  }
}

export interface VoiceAudioPlaybackHandle {
  enqueuePcm24kBase64: (base64Pcm: string) => void;
  interrupt: () => void;
  close: () => Promise<void>;
}

export interface VoiceAudioCaptureHandle {
  setMuted: (muted: boolean) => void;
  close: () => Promise<void>;
}

export interface VoiceLiveSessionAdapter {
  connect: (params: {
    token: string;
    model: string;
    apiVersion: 'v1alpha';
    connectParams: LiveConnectParameters;
  }) => Promise<Session>;
}

export interface VoiceServiceDeps {
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  requestMicrophone?: () => Promise<MediaStream>;
  createLiveSession?: VoiceLiveSessionAdapter['connect'];
  createCapture?: (params: {
    stream: MediaStream;
    onAudioChunk: (base64Pcm16k: string, level: number) => void;
    onCaptureError: (error: Error) => void;
  }) => Promise<VoiceAudioCaptureHandle>;
  createPlayback?: (params: {
    onPlaybackStateChange: (isPlaying: boolean) => void;
  }) => VoiceAudioPlaybackHandle;
  connectTimeoutMs?: number;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
}

export interface VoiceSessionSnapshot {
  state: VoiceSessionState;
  isMuted: boolean;
  micLevel: number;
  model: string;
  errorMessage: string | null;
  errorCode: VoiceErrorCode | null;
  transcripts: VoiceTranscriptEntry[];
}

export interface VoiceSessionCallbacks {
  onStateChange?: (state: VoiceSessionState) => void;
  onMutedChange?: (muted: boolean) => void;
  onMicLevel?: (level: number) => void;
  onTranscriptsChange?: (transcripts: VoiceTranscriptEntry[]) => void;
  onError?: (error: VoiceServiceError) => void;
  onRequireAuth?: () => void;
}

export const DEFAULT_VOICE_MODEL = 'gemini-3.8-live';
export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 2;
const DEFAULT_RECONNECT_DELAY_MS = 800;

const PCM_WORKLET_PROCESSOR_SOURCE = `
class KlyvoPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      const channelData = input[0];
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('klyvo-pcm-capture-processor', KlyvoPcmCaptureProcessor);
`;

export function downsampleFloat32ToInt16Pcm(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = INPUT_SAMPLE_RATE,
): Int16Array {
  if (samples.length === 0) return new Int16Array(0);

  if (
    !Number.isFinite(sourceSampleRate) ||
    sourceSampleRate <= 0 ||
    Math.abs(sourceSampleRate - targetSampleRate) < 1
  ) {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
    return pcm;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.floor(samples.length / ratio));
  const pcm = new Int16Array(targetLength);

  for (let i = 0; i < targetLength; i += 1) {
    const exactIndex = i * ratio;
    const lowIndex = Math.floor(exactIndex);
    const highIndex = Math.min(samples.length - 1, lowIndex + 1);
    const frac = exactIndex - lowIndex;
    const interpolated =
      samples[lowIndex] + (samples[highIndex] - samples[lowIndex]) * frac;
    const clamped = Math.max(-1, Math.min(1, interpolated));
    pcm[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }

  return pcm;
}

export function computeNormalizedRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return Math.min(1, Math.max(0, rms * 4));
}

export function encodeInt16PcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function decodeBase64Pcm16ToFloat32(base64Pcm: string): Float32Array {
  const binary = atob(base64Pcm);
  const byteLength = binary.length;
  const evenBytes = byteLength - (byteLength % 2);
  if (evenBytes <= 0) return new Float32Array(0);

  const bytes = new Uint8Array(evenBytes);
  for (let i = 0; i < evenBytes; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const view = new DataView(bytes.buffer);
  const frameCount = evenBytes / 2;
  const floatSamples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    const int16 = view.getInt16(i * 2, true);
    floatSamples[i] = int16 / 0x8000;
  }
  return floatSamples;
}

function getVoiceTokenEndpoint(): string {
  const metaEnv = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  )?.env;
  const base = (metaEnv?.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
  return `${base}/voice-token`;
}

async function defaultGetSupabaseAccessToken(): Promise<string> {
  const { supabase } = await import('../config/supabase');
  if (!supabase) {
    throw new VoiceServiceError(
      'Supabase authentication is not configured.',
      'SUPABASE_NOT_CONFIGURED',
      { status: 401, recoverable: false },
    );
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new VoiceServiceError(
      'Sign in to your Klyvo account to start a live voice conversation.',
      'UNAUTHENTICATED',
      { status: 401, recoverable: false },
    );
  }

  const expiresAtMs = (data.session.expires_at ?? 0) * 1000;
  if (expiresAtMs > 0 && expiresAtMs - Date.now() < 15_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session?.access_token) {
      return refreshed.data.session.access_token;
    }
  }

  return data.session.access_token;
}

export async function requestVoiceEphemeralToken(options?: {
  accessToken?: string;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<VoiceTokenResponse> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const getToken = options?.getAccessToken ?? defaultGetSupabaseAccessToken;
  const accessToken = options?.accessToken ?? (await getToken());

  const endpoint = getVoiceTokenEndpoint();
  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: options?.signal,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new VoiceServiceError(
      'Unable to reach the voice token service. Check your connection and try again.',
      'TOKEN_ERROR',
      { recoverable: true },
    );
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const serverMessage =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `Voice token request failed (${response.status}).`;
    const serverCode = typeof payload?.code === 'string' ? payload.code : '';

    if (response.status === 401) {
      throw new VoiceServiceError(serverMessage, 'UNAUTHENTICATED', {
        status: 401,
        recoverable: false,
      });
    }
    if (response.status === 429 || serverCode === 'RATE_LIMITED') {
      throw new VoiceServiceError(serverMessage, 'RATE_LIMITED', {
        status: 429,
        recoverable: true,
      });
    }
    throw new VoiceServiceError(serverMessage, 'TOKEN_ERROR', {
      status: response.status,
      recoverable: response.status >= 500,
    });
  }

  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
  const model =
    typeof payload?.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : DEFAULT_VOICE_MODEL;
  const apiVersion = payload?.apiVersion === 'v1alpha' ? 'v1alpha' : 'v1alpha';
  const expireTime =
    typeof payload?.expireTime === 'string' ? payload.expireTime : '';
  const newSessionExpireTime =
    typeof payload?.newSessionExpireTime === 'string'
      ? payload.newSessionExpireTime
      : '';
  const uses = typeof payload?.uses === 'number' ? payload.uses : 1;

  if (!token) {
    throw new VoiceServiceError(
      'The server returned an empty voice session token.',
      'TOKEN_ERROR',
      { status: 502, recoverable: true },
    );
  }

  return {
    token,
    model,
    apiVersion,
    expireTime,
    newSessionExpireTime,
    uses,
  };
}

export function classifyMicrophoneError(error: unknown): VoiceServiceError {
  if (error instanceof VoiceServiceError) {
    return error;
  }

  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    message.includes('permission') ||
    message.includes('denied')
  ) {
    return new VoiceServiceError(
      'Microphone access was denied. Allow microphone permission in your browser site settings (click the lock or microphone icon in the address bar) and reload or retry.',
      'PERMISSION_DENIED',
      { recoverable: true },
    );
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new VoiceServiceError(
      'No microphone was detected on this device. Connect a microphone and try again.',
      'MICROPHONE_UNAVAILABLE',
      { recoverable: true },
    );
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return new VoiceServiceError(
      'Your microphone is currently in use by another application or could not be opened.',
      'MICROPHONE_UNAVAILABLE',
      { recoverable: true },
    );
  }

  return new VoiceServiceError(
    'Unable to access your microphone in this browser.',
    'AUDIO_UNSUPPORTED',
    { recoverable: true },
  );
}

async function defaultRequestMicrophone(): Promise<MediaStream> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    throw new VoiceServiceError(
      'Microphone capture is not supported in this browser or context.',
      'AUDIO_UNSUPPORTED',
      { recoverable: false },
    );
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err: unknown) {
    throw classifyMicrophoneError(err);
  }
}

async function defaultCreateAudioCapture(params: {
  stream: MediaStream;
  onAudioChunk: (base64Pcm16k: string, level: number) => void;
  onCaptureError: (error: Error) => void;
}): Promise<VoiceAudioCaptureHandle> {
  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;

  if (!AudioCtx) {
    throw new VoiceServiceError(
      'Web Audio API is not supported in this browser.',
      'AUDIO_UNSUPPORTED',
      { recoverable: false },
    );
  }

  let audioCtx: AudioContext;
  try {
    audioCtx = new AudioCtx({ sampleRate: INPUT_SAMPLE_RATE });
  } catch {
    audioCtx = new AudioCtx();
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const sourceNode = audioCtx.createMediaStreamSource(params.stream);
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;

  let isMuted = false;
  let closed = false;
  let workletNode: AudioWorkletNode | null = null;
  let scriptProcessor: ScriptProcessorNode | null = null;
  let workletBlobUrl: string | null = null;

  // Buffer ~100ms of samples before encoding & sending to avoid tiny packet overhead
  const targetFlushSamples = Math.max(512, Math.round(audioCtx.sampleRate * 0.08));
  let pendingChunks: Float32Array[] = [];
  let pendingSampleCount = 0;

  const processSamples = (samples: Float32Array) => {
    if (closed || isMuted || samples.length === 0) return;

    pendingChunks.push(samples);
    pendingSampleCount += samples.length;

    if (pendingSampleCount < targetFlushSamples) {
      return;
    }

    const merged = new Float32Array(pendingSampleCount);
    let offset = 0;
    for (const chunk of pendingChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pendingChunks = [];
    pendingSampleCount = 0;

    const level = computeNormalizedRmsLevel(merged);
    const pcm16 = downsampleFloat32ToInt16Pcm(
      merged,
      audioCtx.sampleRate,
      INPUT_SAMPLE_RATE,
    );
    if (pcm16.length > 0) {
      params.onAudioChunk(encodeInt16PcmToBase64(pcm16), level);
    }
  };

  let usedWorklet = false;
  if (
    typeof AudioWorkletNode !== 'undefined' &&
    audioCtx.audioWorklet &&
    typeof audioCtx.audioWorklet.addModule === 'function'
  ) {
    try {
      const blob = new Blob([PCM_WORKLET_PROCESSOR_SOURCE], {
        type: 'application/javascript',
      });
      workletBlobUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletBlobUrl);
      workletNode = new AudioWorkletNode(
        audioCtx,
        'klyvo-pcm-capture-processor',
      );
      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (event.data instanceof Float32Array) {
          processSamples(event.data);
        }
      };
      workletNode.onprocessorerror = () => {
        if (!closed) {
          params.onCaptureError(new Error('Audio capture processor encountered an error.'));
        }
      };
      sourceNode.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      usedWorklet = true;
    } catch {
      // Fall back cleanly to ScriptProcessorNode below
      if (workletBlobUrl) {
        URL.revokeObjectURL(workletBlobUrl);
        workletBlobUrl = null;
      }
      workletNode = null;
    }
  }

  if (!usedWorklet) {
    scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      const channel = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      processSamples(copy);
    };
    sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(silentGain);
    silentGain.connect(audioCtx.destination);
  }

  return {
    setMuted(muted: boolean) {
      isMuted = muted;
      pendingChunks = [];
      pendingSampleCount = 0;
      for (const track of params.stream.getAudioTracks()) {
        track.enabled = !muted;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      pendingChunks = [];
      pendingSampleCount = 0;

      try {
        if (workletNode) {
          workletNode.port.onmessage = null;
          workletNode.disconnect();
        }
        if (scriptProcessor) {
          scriptProcessor.onaudioprocess = null;
          scriptProcessor.disconnect();
        }
        sourceNode.disconnect();
        silentGain.disconnect();
      } catch {
        // Ignore already-disconnected audio graph nodes
      }

      if (workletBlobUrl) {
        URL.revokeObjectURL(workletBlobUrl);
        workletBlobUrl = null;
      }

      if (audioCtx.state !== 'closed') {
        try {
          await audioCtx.close();
        } catch {
          // Ignore close errors
        }
      }
    },
  };
}

function defaultCreateAudioPlayback(params: {
  onPlaybackStateChange: (isPlaying: boolean) => void;
}): VoiceAudioPlaybackHandle {
  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;

  let outputCtx: AudioContext | null = null;
  let nextStartTime = 0;
  let closed = false;
  const activeSources = new Set<AudioBufferSourceNode>();

  const ensureContext = (): AudioContext | null => {
    if (closed || !AudioCtx) return null;
    if (!outputCtx) {
      try {
        outputCtx = new AudioCtx({ sampleRate: OUTPUT_SAMPLE_RATE });
      } catch {
        outputCtx = new AudioCtx();
      }
    }
    if (outputCtx.state === 'suspended') {
      void outputCtx.resume().catch(() => {});
    }
    return outputCtx;
  };

  const stopAllSources = () => {
    for (const src of activeSources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    activeSources.clear();
    nextStartTime = 0;
    params.onPlaybackStateChange(false);
  };

  return {
    enqueuePcm24kBase64(base64Pcm: string) {
      if (closed || !base64Pcm) return;
      const ctx = ensureContext();
      if (!ctx) return;

      const samples = decodeBase64Pcm16ToFloat32(base64Pcm);
      if (samples.length === 0) return;

      const buffer = ctx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
      buffer.copyToChannel(new Float32Array(samples), 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime, nextStartTime);
      nextStartTime = startAt + buffer.duration;

      const wasEmpty = activeSources.size === 0;
      activeSources.add(source);
      if (wasEmpty) {
        params.onPlaybackStateChange(true);
      }

      source.onended = () => {
        activeSources.delete(source);
        try {
          source.disconnect();
        } catch {
          // Ignore
        }
        if (activeSources.size === 0 && !closed) {
          nextStartTime = 0;
          params.onPlaybackStateChange(false);
        }
      };

      source.start(startAt);
    },
    interrupt() {
      stopAllSources();
    },
    async close() {
      if (closed) return;
      closed = true;
      stopAllSources();
      if (outputCtx && outputCtx.state !== 'closed') {
        try {
          await outputCtx.close();
        } catch {
          // Ignore
        }
      }
      outputCtx = null;
    },
  };
}

async function defaultCreateLiveSession(params: {
  token: string;
  model: string;
  apiVersion: 'v1alpha';
  connectParams: LiveConnectParameters;
}): Promise<Session> {
  const ai = new GoogleGenAI({
    apiKey: params.token,
    httpOptions: {
      apiVersion: params.apiVersion,
    },
  });

  return ai.live.connect(params.connectParams);
}

function isTokenExpiryReason(reason: string, code?: number): boolean {
  const lower = reason.toLowerCase();
  return (
    code === 4401 ||
    code === 4403 ||
    lower.includes('expired') ||
    lower.includes('token') ||
    lower.includes('goaway')
  );
}

function createTranscriptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class KlyvoVoiceEngine {
  private readonly deps: VoiceServiceDeps;
  private readonly callbacks: VoiceSessionCallbacks;
  private readonly connectTimeoutMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelayMs: number;

  private state: VoiceSessionState = 'idle';
  private isMuted = false;
  private micLevel = 0;
  private model = DEFAULT_VOICE_MODEL;
  private errorMessage: string | null = null;
  private errorCode: VoiceErrorCode | null = null;
  private transcripts: VoiceTranscriptEntry[] = [];

  private generation = 0;
  private disposed = false;
  private userStopping = false;
  private reconnectAttempts = 0;
  private userTurnHasInterim = false;

  private session: Session | null = null;
  private mediaStream: MediaStream | null = null;
  private captureHandle: VoiceAudioCaptureHandle | null = null;
  private playbackHandle: VoiceAudioPlaybackHandle | null = null;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activeAbortController: AbortController | null = null;

  constructor(callbacks: VoiceSessionCallbacks = {}, deps: VoiceServiceDeps = {}) {
    this.callbacks = callbacks;
    this.deps = deps;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.maxReconnectAttempts =
      deps.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.reconnectDelayMs = deps.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  getSnapshot(): VoiceSessionSnapshot {
    return {
      state: this.state,
      isMuted: this.isMuted,
      micLevel: this.micLevel,
      model: this.model,
      errorMessage: this.errorMessage,
      errorCode: this.errorCode,
      transcripts: [...this.transcripts],
    };
  }

  private setState(nextState: VoiceSessionState) {
    if (this.disposed) return;
    if (this.state === nextState) return;
    this.state = nextState;
    this.callbacks.onStateChange?.(nextState);
  }

  private setMicLevel(level: number) {
    if (this.disposed) return;
    this.micLevel = level;
    this.callbacks.onMicLevel?.(level);
  }

  private emitTranscripts() {
    if (this.disposed) return;
    this.callbacks.onTranscriptsChange?.([...this.transcripts]);
  }

  private upsertTranscript(
    speaker: VoiceTranscriptSpeaker,
    textChunk: string,
    options: { isFinal: boolean; replaceCurrent?: boolean },
  ) {
    if (!textChunk) return;

    const last = this.transcripts[this.transcripts.length - 1];
    if (last && last.speaker === speaker && !last.isFinal) {
      const nextText = options.replaceCurrent
        ? textChunk
        : `${last.text}${textChunk}`;
      this.transcripts = [
        ...this.transcripts.slice(0, -1),
        {
          ...last,
          text: nextText,
          isFinal: options.isFinal,
        },
      ];
    } else {
      this.transcripts = [
        ...this.transcripts,
        {
          id: createTranscriptId(),
          speaker,
          text: textChunk,
          isFinal: options.isFinal,
          timestamp: new Date().toISOString(),
        },
      ];
    }

    this.emitTranscripts();
  }

  private finalizeSpeakerTurn(speaker: VoiceTranscriptSpeaker) {
    if (speaker === 'user') {
      this.userTurnHasInterim = false;
    }
    const idx = this.transcripts.length - 1;
    if (idx < 0) return;
    const last = this.transcripts[idx];
    if (last.speaker === speaker && !last.isFinal) {
      this.transcripts = [
        ...this.transcripts.slice(0, -1),
        { ...last, isFinal: true },
      ];
      this.emitTranscripts();
    }
  }

  private clearTimers() {
    if (this.tokenRefreshTimer !== null) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async releaseResources(options?: { keepStream?: boolean }) {
    this.clearTimers();

    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    const currentSession = this.session;
    this.session = null;
    if (currentSession) {
      try {
        currentSession.close();
      } catch {
        // Ignore close errors
      }
    }

    const currentPlayback = this.playbackHandle;
    this.playbackHandle = null;
    if (currentPlayback) {
      await currentPlayback.close().catch(() => {});
    }

    if (!options?.keepStream) {
      const currentCapture = this.captureHandle;
      this.captureHandle = null;
      if (currentCapture) {
        await currentCapture.close().catch(() => {});
      }

      const currentStream = this.mediaStream;
      this.mediaStream = null;
      if (currentStream) {
        for (const track of currentStream.getTracks()) {
          try {
            track.stop();
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  async start(): Promise<void> {
    if (this.disposed) return;

    // Prevent duplicate concurrent sessions on repeated Start clicks
    if (this.state !== 'idle' && this.state !== 'error') {
      return;
    }

    const runGeneration = ++this.generation;
    this.userStopping = false;
    this.reconnectAttempts = 0;
    this.errorMessage = null;
    this.errorCode = null;
    this.isMuted = false;
    this.callbacks.onMutedChange?.(false);
    this.setMicLevel(0);

    try {
      this.setState('requesting_permission');
      const requestMic = this.deps.requestMicrophone ?? defaultRequestMicrophone;
      const stream = await requestMic();

      if (this.disposed || runGeneration !== this.generation || this.userStopping) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // Ignore
          }
        }
        return;
      }

      this.mediaStream = stream;
      await this.establishLiveSession(runGeneration, { isReconnect: false });
    } catch (err: unknown) {
      if (this.disposed || runGeneration !== this.generation || this.userStopping) {
        return;
      }

      const voiceErr =
        err instanceof VoiceServiceError
          ? err
          : classifyMicrophoneError(err);

      await this.releaseResources();
      this.errorMessage = voiceErr.message;
      this.errorCode = voiceErr.code;
      this.setState('error');
      this.callbacks.onError?.(voiceErr);

      if (voiceErr.code === 'UNAUTHENTICATED') {
        this.callbacks.onRequireAuth?.();
      }
    }
  }

  private async establishLiveSession(
    runGeneration: number,
    options: { isReconnect: boolean },
  ): Promise<void> {
    if (this.disposed || runGeneration !== this.generation || this.userStopping) {
      return;
    }

    this.setState(options.isReconnect ? 'reconnecting' : 'connecting');

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const tokenData = await requestVoiceEphemeralToken({
      getAccessToken: this.deps.getAccessToken,
      fetchImpl: this.deps.fetchImpl,
      signal: abortController.signal,
    });

    if (this.disposed || runGeneration !== this.generation || this.userStopping) {
      return;
    }

    this.model = tokenData.model || DEFAULT_VOICE_MODEL;

    // Create playback handle (or reuse if clean)
    if (!this.playbackHandle) {
      const createPlayback =
        this.deps.createPlayback ?? defaultCreateAudioPlayback;
      this.playbackHandle = createPlayback({
        onPlaybackStateChange: (isPlaying) => {
          if (this.disposed || runGeneration !== this.generation || this.userStopping) {
            return;
          }
          if (this.state === 'listening' || this.state === 'speaking') {
            this.setState(isPlaying ? 'speaking' : 'listening');
          }
        },
      });
    }

    const connectLive = this.deps.createLiveSession ?? defaultCreateLiveSession;

    let sessionOpened = false;
    let earlyReject: ((err: VoiceServiceError) => void) | null = null;
    let earlyRejected = false;

    const failEarlyConnect = (voiceErr: VoiceServiceError) => {
      if (earlyRejected) return;
      earlyRejected = true;
      earlyReject?.(voiceErr);
    };

    const connectPromise = connectLive({
      token: tokenData.token,
      model: this.model,
      apiVersion: tokenData.apiVersion,
      connectParams: {
        model: this.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Zephyr',
              },
            },
          },
          systemInstruction:
            'You are Klyvo, a helpful, concise real-time voice assistant built by Klyscape. Keep spoken replies natural, clear, and conversational.',
        },
        callbacks: {
          onopen: () => {
            sessionOpened = true;
          },
          onmessage: (message: LiveServerMessage) => {
            if (
              this.disposed ||
              runGeneration !== this.generation ||
              this.userStopping
            ) {
              return;
            }
            this.handleServerMessage(message);
          },
          onerror: (event: ErrorEvent) => {
            if (
              this.disposed ||
              runGeneration !== this.generation ||
              this.userStopping
            ) {
              return;
            }
            const msg =
              typeof event?.message === 'string' && event.message.trim()
                ? event.message.trim()
                : 'Live voice WebSocket connection encountered an error.';
            if (!sessionOpened) {
              failEarlyConnect(
                new VoiceServiceError(msg, 'CONNECTION_ERROR', {
                  recoverable: true,
                }),
              );
            } else {
              void this.handleUnexpectedDisconnect(runGeneration, msg);
            }
          },
          onclose: (event: CloseEvent) => {
            if (
              this.disposed ||
              runGeneration !== this.generation ||
              this.userStopping
            ) {
              return;
            }
            const code = event?.code;
            const reason =
              typeof event?.reason === 'string' ? event.reason.trim() : '';

            if (!sessionOpened || !this.session) {
              const expired = isTokenExpiryReason(reason, code);
              failEarlyConnect(
                new VoiceServiceError(
                  reason ||
                    (expired
                      ? 'Voice session token expired before connection completed.'
                      : 'Unable to open Gemini Live voice session.'),
                  expired ? 'TOKEN_EXPIRED' : 'CONNECTION_ERROR',
                  { recoverable: true },
                ),
              );
              return;
            }

            if (code !== 1000 || isTokenExpiryReason(reason, code)) {
              void this.handleUnexpectedDisconnect(
                runGeneration,
                reason || `Connection closed (${code ?? 'unknown'})`,
                code,
              );
            } else {
              void this.stop();
            }
          },
        },
      },
    });

    const earlyFailurePromise = new Promise<never>((_resolve, reject) => {
      earlyReject = reject;
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new VoiceServiceError(
            'Timed out while connecting to Gemini Live voice service.',
            'CONNECTION_ERROR',
            { recoverable: true },
          ),
        );
      }, this.connectTimeoutMs);
    });

    let liveSession: Session;
    try {
      liveSession = await Promise.race([
        connectPromise,
        earlyFailurePromise,
        timeoutPromise,
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }

    if (this.disposed || runGeneration !== this.generation || this.userStopping) {
      try {
        liveSession.close();
      } catch {
        // Ignore
      }
      return;
    }

    this.session = liveSession;
    this.reconnectAttempts = 0;

    // Schedule proactive refresh before token expireTime if provided
    this.scheduleProactiveTokenRefresh(runGeneration, tokenData.expireTime);

    // Attach audio capture if not already running (preserved across reconnects)
    if (!this.captureHandle && this.mediaStream) {
      const createCapture =
        this.deps.createCapture ?? defaultCreateAudioCapture;
      this.captureHandle = await createCapture({
        stream: this.mediaStream,
        onAudioChunk: (base64Pcm16k, level) => {
          if (
            this.disposed ||
            runGeneration !== this.generation ||
            this.userStopping ||
            this.isMuted
          ) {
            return;
          }
          this.setMicLevel(level);
          if (this.session && (this.state === 'listening' || this.state === 'speaking')) {
            try {
              this.session.sendRealtimeInput({
                audio: {
                  data: base64Pcm16k,
                  mimeType: 'audio/pcm;rate=16000',
                },
              });
            } catch {
              // Session closing or transient write error handled by onclose/onerror
            }
          }
        },
        onCaptureError: (err) => {
          if (this.disposed || runGeneration !== this.generation || this.userStopping) {
            return;
          }
          void this.handleUnexpectedDisconnect(runGeneration, err.message);
        },
      });
    }

    if (this.captureHandle && this.isMuted) {
      this.captureHandle.setMuted(true);
    }

    this.setState('listening');
  }

  private scheduleProactiveTokenRefresh(
    runGeneration: number,
    expireTimeIso: string,
  ) {
    if (!expireTimeIso) return;
    const expireMs = Date.parse(expireTimeIso);
    if (!Number.isFinite(expireMs)) return;

    // Refresh 60s before token expiry (minimum 10s delay)
    const delayMs = expireMs - Date.now() - 60_000;
    if (delayMs <= 10_000) return;

    this.tokenRefreshTimer = setTimeout(() => {
      if (this.disposed || runGeneration !== this.generation || this.userStopping) {
        return;
      }
      void this.reconnectForNewToken(runGeneration);
    }, delayMs);
  }

  private async reconnectForNewToken(runGeneration: number): Promise<void> {
    if (this.disposed || runGeneration !== this.generation || this.userStopping) {
      return;
    }

    this.finalizeSpeakerTurn('user');
    this.finalizeSpeakerTurn('assistant');
    await this.releaseResources({ keepStream: true });

    try {
      await this.establishLiveSession(runGeneration, { isReconnect: true });
    } catch (err: unknown) {
      if (this.disposed || runGeneration !== this.generation || this.userStopping) {
        return;
      }
      const voiceErr =
        err instanceof VoiceServiceError
          ? err
          : new VoiceServiceError(
              err instanceof Error
                ? err.message
                : 'Unable to renew voice session token.',
              'TOKEN_EXPIRED',
              { recoverable: true },
            );
      await this.releaseResources();
      this.errorMessage = voiceErr.message;
      this.errorCode = voiceErr.code;
      this.setState('error');
      this.callbacks.onError?.(voiceErr);
    }
  }

  private async handleUnexpectedDisconnect(
    runGeneration: number,
    reason: string,
    closeCode?: number,
  ): Promise<void> {
    if (this.disposed || runGeneration !== this.generation || this.userStopping) {
      return;
    }

    if (this.state === 'reconnecting' || this.state === 'error' || this.state === 'idle') {
      return;
    }

    this.finalizeSpeakerTurn('user');
    this.finalizeSpeakerTurn('assistant');

    const canReconnect =
      this.reconnectAttempts < this.maxReconnectAttempts &&
      Boolean(this.mediaStream);

    if (!canReconnect) {
      const code: VoiceErrorCode = isTokenExpiryReason(reason, closeCode)
        ? 'TOKEN_EXPIRED'
        : 'CONNECTION_ERROR';
      await this.releaseResources();
      const voiceErr = new VoiceServiceError(
        reason || 'Live voice connection closed unexpectedly.',
        code,
        { recoverable: true },
      );
      this.errorMessage = voiceErr.message;
      this.errorCode = voiceErr.code;
      this.setState('error');
      this.callbacks.onError?.(voiceErr);
      return;
    }

    this.reconnectAttempts += 1;
    this.setState('reconnecting');

    await this.releaseResources({ keepStream: true });

    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        resolve();
      }, this.reconnectDelayMs);
    });

    if (this.disposed || runGeneration !== this.generation || this.userStopping) {
      return;
    }

    try {
      await this.establishLiveSession(runGeneration, { isReconnect: true });
    } catch (err: unknown) {
      if (this.disposed || runGeneration !== this.generation || this.userStopping) {
        return;
      }
      const voiceErr =
        err instanceof VoiceServiceError
          ? err
          : new VoiceServiceError(
              err instanceof Error
                ? err.message
                : 'Unable to reconnect the live voice session.',
              'CONNECTION_ERROR',
              { recoverable: true },
            );
      await this.releaseResources();
      this.errorMessage = voiceErr.message;
      this.errorCode = voiceErr.code;
      this.setState('error');
      this.callbacks.onError?.(voiceErr);
    }
  }

  handleServerMessage(message: LiveServerMessage): void {
    if (this.disposed || this.userStopping) return;

    if (message.goAway) {
      // Server notified imminent closure; proactively reconnect with a fresh token
      void this.reconnectForNewToken(this.generation);
      return;
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.interrupted) {
      this.playbackHandle?.interrupt();
      this.finalizeSpeakerTurn('assistant');
      if (this.state === 'speaking') {
        this.setState('listening');
      }
    }

    if (content.interimInputTranscription?.text) {
      this.userTurnHasInterim = true;
      this.upsertTranscript('user', content.interimInputTranscription.text, {
        isFinal: false,
        replaceCurrent: true,
      });
    }

    if (content.inputTranscription?.text) {
      const shouldReplaceInterim = this.userTurnHasInterim;
      this.userTurnHasInterim = false;
      this.upsertTranscript('user', content.inputTranscription.text, {
        isFinal: false,
        replaceCurrent: shouldReplaceInterim,
      });
    }

    if (content.outputTranscription?.text) {
      this.finalizeSpeakerTurn('user');
      this.upsertTranscript('assistant', content.outputTranscription.text, {
        isFinal: false,
      });
    }

    const parts = content.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        this.finalizeSpeakerTurn('user');
        this.playbackHandle?.enqueuePcm24kBase64(part.inlineData.data);
      } else if (
        typeof part.text === 'string' &&
        part.text.length > 0 &&
        part.thought !== true &&
        !content.outputTranscription?.text
      ) {
        this.finalizeSpeakerTurn('user');
        this.upsertTranscript('assistant', part.text, { isFinal: false });
      }
    }

    if (content.turnComplete || content.generationComplete) {
      this.finalizeSpeakerTurn('assistant');
    }
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.isMuted = muted;
    this.captureHandle?.setMuted(muted);
    if (muted) {
      this.setMicLevel(0);
      if (this.session) {
        try {
          this.session.sendRealtimeInput({ audioStreamEnd: true });
        } catch {
          // Ignore if session already closed
        }
      }
    }
    this.callbacks.onMutedChange?.(muted);
  }

  toggleMute(): boolean {
    const next = !this.isMuted;
    this.setMuted(next);
    return next;
  }

  clearTranscripts(): void {
    this.userTurnHasInterim = false;
    if (this.transcripts.length === 0) return;
    this.transcripts = [];
    this.emitTranscripts();
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.userStopping = true;
    this.generation += 1;
    this.finalizeSpeakerTurn('user');
    this.finalizeSpeakerTurn('assistant');
    this.setMicLevel(0);
    await this.releaseResources();
    this.errorMessage = null;
    this.errorCode = null;
    this.setState('idle');
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.userStopping = true;
    this.generation += 1;
    this.disposed = true;
    this.transcripts = [];
    await this.releaseResources();
  }
}
