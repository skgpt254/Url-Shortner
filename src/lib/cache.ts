import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy(times: number) {
    // Exponential backoff capped at 5s. A Redis outage should degrade
    // (fall through to Postgres, see redirect.service.ts) rather than
    // hammer a downed instance with reconnect storms.
    return Math.min(times * 200, 5000);
  },
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

/**
 * Cache-aside read with stampede protection.
 *
 * Problem: if a hot key expires and 500 requests arrive in the same
 * millisecond, all 500 will miss the cache and hammer the database with
 * the same expensive query simultaneously ("cache stampede" / "thundering
 * herd"). We solve this with a short-lived Redis lock (SET NX PX): the
 * first request to miss acquires the lock and repopulates the cache; every
 * other concurrent request either waits briefly and retries the cache read,
 * or (if it times out waiting) falls through to the DB itself rather than
 * blocking indefinitely — favoring availability over perfect de-duplication.
 */
export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T | null>
): Promise<T | null> {
  const cached = await redis.get(key);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }

  const lockKey = `lock:${key}`;
  const gotLock = await redis.set(lockKey, '1', 'PX', 2000, 'NX');

  if (gotLock) {
    try {
      const value = await loader();
      if (value !== null) {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      }
      return value;
    } finally {
      await redis.del(lockKey);
    }
  }

  // Someone else is populating the cache right now. Poll briefly for the
  // result rather than immediately hitting the DB ourselves.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 50));
    const value = await redis.get(key);
    if (value !== null) return JSON.parse(value) as T;
  }

  // Lock holder is taking unusually long (or crashed holding the lock) —
  // fall through and hit the loader ourselves rather than waiting forever.
  return loader();
}

export async function invalidateCache(key: string): Promise<void> {
  await redis.del(key);
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
