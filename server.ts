import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import chatHandler from './server/handlers/chat';
import healthHandler from './server/handlers/health';
import voiceTokenHandler from './server/handlers/voice-token';
import { createSecurityHeadersMiddleware } from './server/lib/securityHeaders';
import { toExpressHandler } from './server/webAdapter';

const PORT = Number.parseInt(process.env.PORT || '', 10) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    createSecurityHeadersMiddleware({
      isDevelopment: !IS_PRODUCTION,
    }),
  );

  // Native API routes (do not attach body parsers before Web Standard handlers)
  app.all('/api/chat', toExpressHandler(chatHandler));
  app.all('/api/health', toExpressHandler(healthHandler));
  app.all('/api/voice-token', toExpressHandler(voiceTokenHandler));

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'API route not found.',
      code: 'API_NOT_FOUND',
    });
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Klyvo server listening on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start Klyvo server:', err);
  process.exit(1);
});
