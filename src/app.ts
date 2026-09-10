import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import formbody from '@fastify/formbody';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { pool } from './db/client.js';
import { redis } from './lib/cache.js';

import { linksRoutes, publicLinkRoutes } from './modules/links/links.routes.js';
import { redirectRoutes } from './modules/redirect/redirect.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { apiKeyRoutes } from './modules/apikeys/apikeys.routes.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash', '*.secret'],
        censor: '[REDACTED]',
      },
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    genReqId: () => randomUUID(),
    // Trust the first proxy hop (load balancer / ingress) for X-Forwarded-*
    // headers so request.ip reflects the real client, not the LB's IP —
    // critical for both rate limiting and click analytics to be meaningful.
    // In an environment with multiple proxy hops, set this to the exact
    // hop count instead of `true` to avoid trusting a spoofable header from
    // further upstream.
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MiB — generous for JSON payloads, prevents trivial memory-exhaustion DoS
    disableRequestLogging: config.isProduction, // pino-http-style access logs are noisy; enable via LOG_LEVEL=debug if needed
  });

  // ── Security headers ────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The password-prompt page is inline-styled with no external
        // resources; explicitly disallow everything else.
        imgSrc: ["'self'"],
        scriptSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    // Redirect responses to arbitrary third-party destinations are the
    // product's core function — do not set a restrictive Referrer-Policy
    // that would break analytics on the *destination* site more than
    // necessary; "strict-origin-when-cross-origin" is a reasonable default
    // that still protects against leaking full URLs cross-origin.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  await app.register(cors, {
    // The frontend (see /frontend) is served from its own origin — a
    // separate static host/CDN in real deployments, or its own container
    // port locally — so it's never the same origin as the API even in
    // production. Restricting to `[config.publicBaseUrl]` alone (the
    // API's own origin) would block every real browser request from the
    // actual web app; config.allowedOrigins is the explicit allowlist for
    // this instead.
    origin: config.isProduction ? config.allowedOrigins : true,
    credentials: true,
  });

  await app.register(formbody); // needed for the password-prompt HTML form (application/x-www-form-urlencoded)

  // ── OpenAPI docs ─────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: { title: 'Shortlink Platform API', version: '1.0.0' },
      servers: [{ url: config.publicBaseUrl }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'JWT access token or API key (sl_live_...)' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // ── Health checks (for k8s liveness/readiness probes / LB health checks) ─
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    // Readiness actually verifies downstream dependencies are reachable —
    // a pod that's "alive" but can't reach Postgres/Redis should be pulled
    // out of the load balancer rotation, not sent traffic.
    try {
      await Promise.all([pool.query('SELECT 1'), redis.ping()]);
      return { status: 'ok' };
    } catch (err) {
      logger.error({ err }, 'Readiness check failed');
      reply.status(503);
      return { status: 'unavailable' };
    }
  });

  // ── API routes (versioned) ───────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(publicLinkRoutes, { prefix: '/api/v1' });
  await app.register(linksRoutes, { prefix: '/api/v1' });
  await app.register(apiKeyRoutes, { prefix: '/api/v1' });
  await app.register(analyticsRoutes, { prefix: '/api/v1' });

  // ── Public redirect routes (root level: /:code, not /api/v1/:code) ──
  await app.register(redirectRoutes);

  app.setErrorHandler(errorHandler);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found.` } });
  });

  return app;
}
