import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { pool } from '../../db/client.js';

/**
 * API KEY DESIGN
 * ==============
 * A key looks like:  sl_live_7f3c1a2b_9f8e7d6c5b4a3f2e1d0c...
 *                     └┬┘ └┬─┘ └───┬───┘ └──────────┬─────────┘
 *                    prefix  env   key_prefix (indexed, public)   secret (never stored, only hashed)
 *
 * We store `key_prefix` (indexed, safe to log/display in a UI as
 * "sl_live_7f3c1a2b...") separately from the secret half, so that lookup is
 * a fast indexed query, and only the SHA-256 hash of the secret is ever
 * persisted — identical in spirit to how you'd never store a plaintext
 * password. This means even a full database dump doesn't expose usable
 * API keys.
 *
 * Verification does prefix lookup (cheap, indexed) then a constant-time
 * comparison of the hash to prevent timing side-channels on the secret
 * portion.
 */

const KEY_PREFIX_BYTES = 6;
const KEY_SECRET_BYTES = 24;

export interface GeneratedApiKey {
  /** The full key string — shown to the user exactly once, never persisted. */
  fullKey: string;
  keyPrefix: string;
  secretHash: string;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateApiKey(env: 'live' | 'test' = 'live'): GeneratedApiKey {
  const keyPrefix = randomBytes(KEY_PREFIX_BYTES).toString('hex');
  const secret = randomBytes(KEY_SECRET_BYTES).toString('hex');
  const fullKey = `sl_${env}_${keyPrefix}_${secret}`;
  return { fullKey, keyPrefix, secretHash: hashSecret(secret) };
}

export function parseApiKey(fullKey: string): { keyPrefix: string; secret: string } | null {
  const match = /^sl_(?:live|test)_([0-9a-f]{12})_([0-9a-f]{48})$/.exec(fullKey);
  if (!match) return null;
  return { keyPrefix: match[1]!, secret: match[2]! };
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  scopes: string[];
  revoked_at: string | null;
}

export async function verifyApiKey(fullKey: string): Promise<ApiKeyRecord | null> {
  const parsed = parseApiKey(fullKey);
  if (!parsed) return null;

  const { rows } = await pool.query<ApiKeyRecord & { secret_hash: string }>(
    `SELECT id, user_id, scopes, revoked_at, secret_hash
       FROM api_keys
      WHERE key_prefix = $1`,
    [parsed.keyPrefix]
  );
  const record = rows[0];
  if (!record || record.revoked_at) return null;

  const providedHash = Buffer.from(hashSecret(parsed.secret), 'hex');
  const storedHash = Buffer.from(record.secret_hash, 'hex');
  if (providedHash.length !== storedHash.length || !timingSafeEqual(providedHash, storedHash)) {
    return null;
  }

  // Fire-and-forget last-used timestamp update; not on the critical path
  // and failure here shouldn't fail the request.
  pool
    .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [record.id])
    .catch(() => void 0);

  const { secret_hash: _unused, ...rest } = record;
  return rest;
}
