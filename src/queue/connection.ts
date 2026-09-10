import { config } from '../config/index.js';

/**
 * BullMQ requires its own ioredis-compatible connection options (it manages
 * connections internally rather than accepting a shared client instance in
 * all cases), so we export connection *options* here rather than reusing
 * the app's `redis` singleton from lib/cache.ts.
 */
export const queueConnection = {
  connection: {
    // ioredis accepts either a URL string via a helper or host/port; BullMQ
    // wants an options object, so parse the URL ourselves to stay
    // dependency-light.
    ...parseRedisUrl(config.redis.url),
    maxRetriesPerRequest: null, // required by BullMQ's blocking connections
  },
};

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password || undefined,
    db: parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : undefined,
  };
}
