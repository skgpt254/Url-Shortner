import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { resolveRedirect, PasswordRequiredError } from './redirect.service.js';
import { rateLimitMiddleware } from '../../middleware/rate-limit.middleware.js';
import { verifyPasswordSchema } from '../links/links.schema.js';

const RESERVED_TOP_LEVEL_PATHS = new Set(['api', 'healthz', 'readyz', 'docs', 'favicon.ico']);

function extractClientIp(request: { headers: Record<string, unknown>; ip: string }): string {
  // Fastify's request.ip already respects `trustProxy` (see app.ts) and
  // resolves X-Forwarded-For correctly when behind a known reverse proxy /
  // load balancer — we don't hand-parse the header ourselves to avoid
  // IP-spoofing via a forged header when NOT behind a trusted proxy.
  return request.ip;
}

export async function redirectRoutes(app: FastifyInstance): Promise<void> {
  // A password-protected link's flow is: GET /:code -> 200 HTML password
  // prompt (not a redirect) -> visitor POSTs the password to the same path
  // -> on success we redirect. This keeps the password out of the URL/query
  // string (which would otherwise leak into browser history, server logs,
  // and Referer headers of the destination site).

  app.get('/:code', { preHandler: rateLimitMiddleware('redirect', config.rateLimit.redirectPerMin) }, async (request, reply) => {
    const { code } = request.params as { code: string };
    if (RESERVED_TOP_LEVEL_PATHS.has(code)) {
      reply.status(404);
      return { error: { code: 'NOT_FOUND', message: 'Not found.' } };
    }

    try {
      const result = await resolveRedirect(code, {
        ip: extractClientIp(request),
        userAgent: request.headers['user-agent'] ?? null,
        referrer: request.headers['referer'] ?? null,
      });
      return reply.redirect(result.redirectType, result.destinationUrl);
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        reply.type('text/html').status(200);
        return renderPasswordPromptHtml(code, null);
      }
      throw err;
    }
  });

  app.post('/:code', { preHandler: rateLimitMiddleware('redirect-password', 20) }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const { password } = verifyPasswordSchema.parse(request.body);

    try {
      const result = await resolveRedirect(code, {
        ip: extractClientIp(request),
        userAgent: request.headers['user-agent'] ?? null,
        referrer: request.headers['referer'] ?? null,
        suppliedPassword: password,
      });
      return reply.redirect(result.redirectType, result.destinationUrl);
    } catch (err) {
      if (err instanceof Error && err.name === 'ForbiddenError') {
        reply.type('text/html').status(403);
        return renderPasswordPromptHtml(code, 'Incorrect password. Please try again.');
      }
      throw err;
    }
  });

  const qrQuerySchema = z.object({
    size: z.coerce.number().int().min(64).max(1024).default(256),
  });

  app.get('/:code/qr', async (request, reply) => {
    const { code } = request.params as { code: string };
    const { size } = qrQuerySchema.parse(request.query);
    const targetUrl = `${config.publicBaseUrl}/${code}`;

    const pngBuffer = await QRCode.toBuffer(targetUrl, {
      type: 'png',
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    });

    reply.type('image/png');
    reply.header('Cache-Control', 'public, max-age=86400'); // QR for a given code+size never changes
    return reply.send(pngBuffer);
  });
}

function renderPasswordPromptHtml(code: string, errorMessage: string | null): string {
  // Minimal, dependency-free HTML — intentionally has no external
  // resources (no CDN scripts/styles) to keep this endpoint fast and to
  // avoid giving a phishing-adjacent surface any third-party content to
  // masquerade with.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Password required</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f5; }
    .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 360px; width: 100%; }
    h1 { font-size: 1.1rem; margin: 0 0 1rem; }
    input { width: 100%; padding: 0.6rem; margin-bottom: 0.75rem; border: 1px solid #d4d4d8; border-radius: 6px; box-sizing: border-box; }
    button { width: 100%; padding: 0.6rem; background: #18181b; color: white; border: none; border-radius: 6px; cursor: pointer; }
    .error { color: #dc2626; font-size: 0.875rem; margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔒 This link is password protected</h1>
    ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ''}
    <form method="POST" action="/${encodeURIComponent(code)}">
      <input type="password" name="password" placeholder="Enter password" autofocus required />
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
