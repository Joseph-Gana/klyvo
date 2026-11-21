/**
 * Best-effort, per-instance in-memory sliding-window rate limiter.
 *
 * NOTE: Node/serverless instances do not share in-memory state across restarts
 * or multiple containers. This protects a running server instance from bursts.
 */

const WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 20;
const MAX_TRACKED_USERS = 2_000;

const userRequestTimestamps = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function getMaxRequestsPerMinute(): number {
  const raw = (process.env.KLYVO_MAX_REQUESTS_PER_MINUTE || '').trim();
  if (!raw) return DEFAULT_MAX_REQUESTS_PER_MINUTE;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_REQUESTS_PER_MINUTE;
  }

  return Math.min(parsed, 1_000);
}

function pruneStaleEntries(cutoff: number) {
  if (userRequestTimestamps.size <= MAX_TRACKED_USERS) return;

  for (const [key, timestamps] of userRequestTimestamps.entries()) {
    const active = timestamps.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      userRequestTimestamps.delete(key);
    } else {
      userRequestTimestamps.set(key, active);
    }
  }
}

export function checkUserRateLimit(userId: string): RateLimitResult {
  const limit = getMaxRequestsPerMinute();
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  pruneStaleEntries(cutoff);

  const existing = userRequestTimestamps.get(userId) ?? [];
  const recent = existing.filter((ts) => ts > cutoff);

  if (recent.length >= limit) {
    const oldestRelevant = recent[0] ?? now;
    const retryAfterMs = Math.max(1_000, WINDOW_MS - (now - oldestRelevant));
    userRequestTimestamps.set(userId, recent);

    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1_000),
    };
  }

  recent.push(now);
  userRequestTimestamps.set(userId, recent);

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - recent.length),
    retryAfterSeconds: 0,
  };
}
