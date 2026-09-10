import type { FastifyInstance } from 'fastify';
import { config } from '../../config/index.js';
import { requireAuth, requireScope } from '../../middleware/auth.middleware.js';
import { rateLimitMiddleware } from '../../middleware/rate-limit.middleware.js';
import {
  createLinkSchema,
  updateLinkSchema,
  listLinksQuerySchema,
  bulkCreateSchema,
  quickCreateSchema,
} from './links.schema.js';
import * as service from './links.service.js';
import * as repo from './links.repository.js';
import { ValidationError } from '../../lib/errors.js';

export function toPublicLink(link: repo.LinkRow) {
  return {
    shortCode: link.short_code,
    shortUrl: `${config.publicBaseUrl}/${link.short_code}`,
    destinationUrl: link.destination_url,
    status: link.status,
    isCustomAlias: link.is_custom_alias,
    hasPassword: link.password_hash !== null,
    maxClicks: link.max_clicks,
    clickCount: Number(link.click_count),
    expiresAt: link.expires_at,
    redirectType: link.redirect_type,
    tags: link.tags,
    title: link.title,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
  };
}

/**
 * Public, no-auth-required "quick shorten" endpoint — this is what powers
 * the homepage hero box (see frontend/src/pages/Landing.tsx), matching the
 * classic bitly/TinyURL experience of shortening a link before signing up.
 * Kept as a separate, unauthenticated plugin (rather than making /links
 * optionally-authenticated) so its much stricter feature set — URL only,
 * no alias/password/expiry — and its own anonymous-tier rate limit are
 * enforced structurally, not by an easy-to-miss conditional inside the
 * full-featured endpoint.
 */
export async function publicLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/links/quick',
    { preHandler: rateLimitMiddleware('anonymous-create', config.rateLimit.anonymousPerMin) },
    async (request, reply) => {
      const { url } = quickCreateSchema.parse(request.body);
      const link = await service.createLink(null, { url, redirectType: 302 });
      reply.status(201);
      return { link: toPublicLink(link) };
    }
  );
}

export async function linksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post(
    '/links',
    { preHandler: [requireScope('links:write'), rateLimitMiddleware('create-link')] },
    async (request, reply) => {
      const input = createLinkSchema.parse(request.body);
      const idempotencyKey = (request.headers['idempotency-key'] as string | undefined) ?? null;
      const userId = request.auth!.userId;

      if (idempotencyKey) {
        const existing = await service.getExistingByIdempotencyKey(userId, idempotencyKey);
        if (existing) {
          reply.status(200);
          return { link: toPublicLink(existing), idempotentReplay: true };
        }
      }

      const link = await service.createLink(userId, input, idempotencyKey);
      reply.status(201);
      return { link: toPublicLink(link) };
    }
  );

  app.post(
    '/links/bulk',
    { preHandler: [requireScope('links:write'), rateLimitMiddleware('create-link-bulk', 5)] },
    async (request) => {
      const { links } = bulkCreateSchema.parse(request.body);
      const userId = request.auth!.userId;

      // Process sequentially rather than Promise.all: bulk imports can be
      // hundreds of rows, and unbounded parallel DB connections from a
      // single request would starve the pool for every other tenant.
      // (For very large imports, this belongs in a background job with a
      // status-polling endpoint rather than a synchronous request — noted
      // as a scaling extension point.)
      const results: Array<{ ok: true; link: ReturnType<typeof toPublicLink> } | { ok: false; error: string; input: unknown }> = [];
      for (const item of links) {
        try {
          const link = await service.createLink(userId, item);
          results.push({ ok: true, link: toPublicLink(link) });
        } catch (err) {
          results.push({ ok: false, error: err instanceof Error ? err.message : 'Unknown error', input: item });
        }
      }
      return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    }
  );

  app.get('/links', { preHandler: requireScope('links:read') }, async (request) => {
    const query = listLinksQuerySchema.parse(request.query);
    const userId = request.auth!.userId;
    const rows = await repo.listLinksForUser({
      userId,
      limit: query.limit,
      cursorCreatedAt: query.cursor,
      tag: query.tag,
      status: query.status,
    });
    const nextCursor = rows.length === query.limit ? rows[rows.length - 1]!.created_at : null;
    return { links: rows.map(toPublicLink), nextCursor };
  });

  app.get('/links/:code', { preHandler: requireScope('links:read') }, async (request) => {
    const { code } = request.params as { code: string };
    const link = await repo.findOwnedByShortCode(request.auth!.userId, code);
    if (!link) throw new ValidationError('Link not found.');
    return { link: toPublicLink(link) };
  });

  app.patch('/links/:code', { preHandler: requireScope('links:write') }, async (request) => {
    const { code } = request.params as { code: string };
    const input = updateLinkSchema.parse(request.body);
    const link = await service.updateLink(request.auth!.userId, code, input);
    return { link: toPublicLink(link) };
  });

  app.delete('/links/:code', { preHandler: requireScope('links:write') }, async (request, reply) => {
    const { code } = request.params as { code: string };
    await service.deleteLink(request.auth!.userId, code);
    reply.status(204);
  });
}
