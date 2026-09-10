import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

/**
 * node-postgres derives SSL behavior from TWO places if you're not
 * careful: the `sslmode=` query parameter embedded in the connection
 * string itself, AND the separate `ssl` option passed to the Pool
 * constructor. When both are present, the merge between them is
 * ambiguous and provider-dependent — this is exactly what caused a
 * persistent DEPTH_ZERO_SELF_SIGNED_CERT error against Render's Postgres
 * even after correctly setting `{ rejectUnauthorized: false }` in the
 * explicit ssl object: Render's connection string carries its own
 * `sslmode` parameter, which was winning the merge.
 *
 * The fix is to make our own explicit `ssl` option the ONLY source of
 * truth: strip any ssl-related query params from the connection string
 * before handing it to pg, and always pass a concrete `ssl` value
 * (`false` literal, never `undefined`) so there's nothing left for pg to
 * infer from the URL.
 */
function stripSslParams(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('ssl');
    return parsed.toString();
  } catch {
    return url;
  }
}

export const pool = new pg.Pool({
  connectionString: stripSslParams(config.db.url),
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle Postgres client');
});

pool.on('connect', () => {
  logger.debug('New Postgres connection established');
});

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDbPool(): Promise<void> {
  await pool.end();
}