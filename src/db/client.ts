import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export const pool = new pg.Pool({
  connectionString: config.db.url,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  // Fail fast rather than hanging forever if the DB is unreachable — a
  // hung connection acquisition under load is worse than a fast error that
  // triggers our circuit breaker / 503 response.
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Emitted for errors on *idle* clients in the pool (e.g. the DB restarted
  // underneath us). Must be handled or it crashes the process.
  logger.error({ err }, 'Unexpected error on idle Postgres client');
});

pool.on('connect', () => {
  logger.debug('New Postgres connection established');
});

/**
 * Executes `fn` inside a single transaction. Automatically rolls back on
 * any thrown error and always releases the client back to the pool.
 */
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
