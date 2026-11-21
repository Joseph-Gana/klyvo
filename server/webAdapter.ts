import { once } from 'node:events';
import { Readable } from 'node:stream';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

export type WebStandardHandler = (request: Request) => Promise<Response>;

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD', 'OPTIONS']);

function buildWebHeaders(req: ExpressRequest): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }

  return headers;
}

function buildRequestUrl(req: ExpressRequest): string {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${protocol}://${host}${req.originalUrl || req.url || '/'}`;
}

export function toExpressHandler(handler: WebStandardHandler) {
  return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const abortController = new AbortController();

    const handleDisconnect = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };

    const handleReqAborted = () => {
      abortController.abort();
    };

    res.on('close', handleDisconnect);
    req.on('aborted', handleReqAborted);

    try {
      const method = (req.method || 'GET').toUpperCase();
      const headers = buildWebHeaders(req);
      const url = buildRequestUrl(req);

      const init: RequestInit & { duplex?: 'half' } = {
        method,
        headers,
        signal: abortController.signal,
      };

      if (!METHODS_WITHOUT_BODY.has(method)) {
        init.body = Readable.toWeb(req) as unknown as BodyInit;
        init.duplex = 'half';
      }

      const webRequest = new Request(url, init);
      const webResponse = await handler(webRequest);

      if (res.writableEnded || res.destroyed) {
        return;
      }

      res.status(webResponse.status);
      webResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (webResponse.status === 204 || !webResponse.body) {
        res.end();
        return;
      }

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      const requestId = webResponse.headers.get('x-klyvo-request-id');
      const isSse = (webResponse.headers.get('content-type') || '')
        .toLowerCase()
        .includes('text/event-stream');

      if (isSse && res.socket && typeof res.socket.setNoDelay === 'function') {
        res.socket.setNoDelay(true);
      }

      const headersFlushedAtMs = Date.now();
      if (requestId) {
        console.info(
          JSON.stringify({
            scope: 'server/webAdapter',
            stage: 'adapter_headers_flushed',
            timestamp: new Date().toISOString(),
            requestId,
            status: webResponse.status,
            isSse,
          }),
        );
      }

      let chunkIndex = 0;
      let totalBytes = 0;

      const reader = webResponse.body.getReader();
      const cancelReaderOnAbort = () => {
        void reader.cancel().catch(() => undefined);
      };
      abortController.signal.addEventListener('abort', cancelReaderOnAbort, {
        once: true,
      });

      try {
        while (true) {
          if (abortController.signal.aborted || res.destroyed || res.writableEnded) {
            await reader.cancel().catch(() => undefined);
            break;
          }

          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value && value.byteLength > 0) {
            chunkIndex += 1;
            totalBytes += value.byteLength;
            const canContinue = res.write(Buffer.from(value));
            if (isSse) {
              const flushableRes = res as ExpressResponse & { flush?: () => void };
              if (typeof flushableRes.flush === 'function') {
                flushableRes.flush();
              }
            }

            if (requestId && (chunkIndex === 1 || chunkIndex <= 5 || chunkIndex % 25 === 0)) {
              console.info(
                JSON.stringify({
                  scope: 'server/webAdapter',
                  stage:
                    chunkIndex === 1
                      ? 'adapter_first_chunk_written'
                      : 'adapter_chunk_written',
                  timestamp: new Date().toISOString(),
                  requestId,
                  chunkIndex,
                  bytes: value.byteLength,
                  sinceHeadersMs: Date.now() - headersFlushedAtMs,
                  backpressure: !canContinue,
                }),
              );
            }

            if (!canContinue && !res.destroyed && !res.writableEnded) {
              await once(res, 'drain');
            }
          }
        }
      } finally {
        abortController.signal.removeEventListener('abort', cancelReaderOnAbort);
        reader.releaseLock();
      }

      if (requestId) {
        console.info(
          JSON.stringify({
            scope: 'server/webAdapter',
            stage: 'adapter_stream_ended',
            timestamp: new Date().toISOString(),
            requestId,
            totalChunks: chunkIndex,
            totalBytes,
            sinceHeadersMs: Date.now() - headersFlushedAtMs,
          }),
        );
      }

      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    } catch (error: unknown) {
      if (!abortController.signal.aborted && !res.headersSent && !res.writableEnded) {
        res.status(500).json({
          error: 'Internal server error.',
          code: 'INTERNAL_SERVER_ERROR',
        });
      } else if (!res.writableEnded && !res.destroyed) {
        res.end();
      }

      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name?: unknown }).name !== 'AbortError'
      ) {
        console.error('[server/webAdapter] Unhandled handler error:', error);
      }
    } finally {
      res.off('close', handleDisconnect);
      req.off('aborted', handleReqAborted);
    }
  };
}
