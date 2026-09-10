import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireScope } from '../../middleware/auth.middleware.js';
import { findOwnedByShortCode } from '../links/links.repository.js';
import { getLinkAnalytics } from './analytics.service.js';
import { ValidationError } from '../../lib/errors.js';

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/links/:code/analytics', { preHandler: requireScope('links:read') }, async (request) => {
    const { code } = request.params as { code: string };
    const { days } = analyticsQuerySchema.parse(request.query);

    const link = await findOwnedByShortCode(request.auth!.userId, code);
    if (!link) throw new ValidationError('Link not found.');

    const analytics = await getLinkAnalytics(link.id, days);
    return { shortCode: code, periodDays: days, analytics };
  });
}
