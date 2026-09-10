import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkRateLimit } from '../lib/rate-limiter.js';
import { RateLimitedError } from '../lib/errors.js';
import { config } from '../config/index.js';

/**
 * Identifies the caller for rate-limiting purposes: authenticated requests
 * are limited per-user (so one user can't be starved by another sharing an
 * IP, e.g. behind NAT/a corporate proxy), anonymous requests fall back to
 * IP. We trust X-Forwarded-For only when behind a known proxy — see
 * app.ts's `trustProxy` config; Fastify resolves request.ip accordingly.
 */
function identifyCaller(request: FastifyRequest): { identifier: string; perMinute: number } {
  if (request.auth) {
    return { identifier: `user:${request.auth.userId}`, perMinute: config.rateLimit.authenticatedPerMin };
  }
  return { identifier: `ip:${request.ip}`, perMinute: config.rateLimit.anonymousPerMin };
}

export function rateLimitMiddleware(bucket: string, overridePerMinute?: number) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { identifier, perMinute } = identifyCaller(request);
    const limit = overridePerMinute ?? perMinute;

    const result = await checkRateLimit({
      identifier,
      bucket,
      capacity: limit,
      perMinute: limit,
    });

    reply.header('X-RateLimit-Limit', limit);
    reply.header('X-RateLimit-Remaining', Math.max(0, result.remaining));

    if (!result.allowed) {
      throw new RateLimitedError(`Rate limit exceeded for ${bucket}. Try again shortly.`);
    }
  };
}
