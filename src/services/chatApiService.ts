import { BRAND_CONFIG } from '../config/brand';
import { supabase } from '../config/supabase';
import {
  ChatApiError,
  type ChatApiTurn,
  type ChatStreamEvent,
  consumeChatSseResponse,
  isChatAbortError,
  normalizeHistoryTurns,
  type StreamGeminiChatResult,
} from './chatStreamParser';

export {
  ChatApiError,
  consumeChatSseResponse,
  normalizeHistoryTurns,
  parseRawSseFrame,
  type ChatApiTurn,
  type ChatStreamEvent,
  type ParsedChatStreamEvent,
  type StreamGeminiChatResult,
} from './chatStreamParser';

export interface StreamGeminiChatParams {
  messages: ChatApiTurn[];
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

async function getValidAccessToken(): Promise<string> {
  if (!supabase) {
    throw new ChatApiError(
      'Supabase authentication is not configured.',
      401,
      'SUPABASE_NOT_CONFIGURED',
    );
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ChatApiError(
      'Sign in to your Klyvo account to chat with Gemini AI.',
      401,
      'UNAUTHENTICATED',
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

export async function streamGeminiChat(
  params: StreamGeminiChatParams,
): Promise<StreamGeminiChatResult> {
  if (params.signal?.aborted) {
    return { completed: false, aborted: true };
  }

  const normalizedMessages = normalizeHistoryTurns(params.messages);
  if (
    normalizedMessages.length === 0 ||
    normalizedMessages[normalizedMessages.length - 1].role !== 'user'
  ) {
    throw new ChatApiError(
      'Cannot send a chat request without a user prompt.',
      400,
      'INVALID_HISTORY',
    );
  }

  const accessToken = await getValidAccessToken();
  const endpoint = `${BRAND_CONFIG.apiBaseUrl}/chat`;
  const requestStartedMs = Date.now();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messages: normalizedMessages,
      }),
      signal: params.signal,
    });
  } catch (error: unknown) {
    if (isChatAbortError(error) || params.signal?.aborted) {
      return { completed: false, aborted: true };
    }
    throw new ChatApiError(
      'Network error while connecting to the chat service.',
      0,
      'NETWORK_ERROR',
    );
  }

  return consumeChatSseResponse({
    response,
    requestStartedMs,
    chatEndpointLabel: endpoint,
    signal: params.signal,
    onEvent: params.onEvent,
  });
}
