import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/client.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { generateApiKey } from '../auth/apikey.service.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(['links:read', 'links:write'])).min(1).default(['links:read', 'links:write']),
});

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post('/api-keys', async (request, reply) => {
    const input = createKeySchema.parse(request.body);
    const { fullKey, keyPrefix, secretHash } = generateApiKey('live');

    const { rows } = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO api_keys (user_id, name, key_prefix, secret_hash, scopes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [request.auth!.userId, input.name, keyPrefix, secretHash, input.scopes]
    );

    reply.status(201);
    // fullKey is returned exactly once, at creation time, and never again —
    // it is not retrievable later since only its hash is persisted.
    return {
      apiKey: {
        id: rows[0]!.id,
        name: input.name,
        scopes: input.scopes,
        createdAt: rows[0]!.created_at,
        key: fullKey,
      },
      warning: 'Store this key now — it will not be shown again.',
    };
  });

  app.get('/api-keys', async (request) => {
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, scopes, last_used_at, created_at, revoked_at
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [request.auth!.userId]
    );
    return {
      apiKeys: rows.map((r) => ({
        id: r.id,
        name: r.name,
        keyPreview: `sl_live_${r.key_prefix}...`,
        scopes: r.scopes,
        lastUsedAt: r.last_used_at,
        createdAt: r.created_at,
        revoked: r.revoked_at !== null,
      })),
    };
  });

  app.delete('/api-keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query<{ user_id: string }>('SELECT user_id FROM api_keys WHERE id = $1', [id]);
    if (!rows[0]) throw new ValidationError('API key not found.');
    if (rows[0].user_id !== request.auth!.userId) throw new ForbiddenError('Not your API key.');

    await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
    reply.status(204);
  });
}
