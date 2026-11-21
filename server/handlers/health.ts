import { isServerSupabaseAuthConfigured } from '../lib/auth';
import {
  getConfiguredGeminiModel,
  getConfiguredThinkingLevel,
  isGeminiConfigured,
} from '../lib/gemini';

export default async function handleHealth(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { Allow: 'GET, OPTIONS' },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Allow: 'GET, OPTIONS',
      },
    });
  }

  const geminiConfigured = isGeminiConfigured();
  const supabaseServerConfigured = isServerSupabaseAuthConfigured();
  const model = getConfiguredGeminiModel();
  const thinkingLevel = getConfiguredThinkingLevel(model) ?? 'default';

  return new Response(
    JSON.stringify({
      service: 'klyvo-api',
      ready: {
        gemini: geminiConfigured,
        supabase: supabaseServerConfigured,
        chat: geminiConfigured && supabaseServerConfigured,
      },
      config: {
        model,
        thinkingLevel,
        apiMode: 'generateContentStream',
      },
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
