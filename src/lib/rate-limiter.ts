import { redis } from './cache.js';

/**
 * TOKEN BUCKET RATE LIMITING VIA REDIS LUA SCRIPT
 * ================================================
 * A naive "GET counter, check < limit, INCR" implementation has a
 * check-then-act race: two concurrent requests can both read a counter of
 * (limit - 1), both pass the check, and both increment — silently
 * admitting one request over the limit. Under real concurrent load this
 * isn't a rare edge case, it's routine.
 *
 * We avoid this by doing the entire check-and-consume operation as a
 * single atomic Redis Lua script (Redis executes scripts atomically —
 * no other command runs in between). The algorithm is a standard token
 * bucket: bucket refills continuously at `refillRate` tokens/sec up to
 * `capacity`, each request consumes 1 token, request is rejected if the
 * bucket is empty.
 *
 * Token bucket over fixed-window counters because fixed windows allow a
 * burst of 2x the limit right at a window boundary (e.g. limit=100/min
 * lets through 100 requests at 0:59 and another 100 at 1:00). Token
 * bucket has no such boundary artifact.
 */

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])  -- tokens per second
local now = tonumber(ARGV[3])          -- current time in ms
local requested = tonumber(ARGV[4])    -- tokens requested (usually 1)

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
local tokens = tonumber(bucket[1])
local last_refill_ms = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last_refill_ms = now
end

local elapsed_seconds = math.max(0, (now - last_refill_ms) / 1000)
tokens = math.min(capacity, tokens + elapsed_seconds * refill_rate)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ms', now)
-- Expire the key well after the bucket would fully refill anyway, so we
-- don't accumulate rate-limit state forever for one-off/abandoned clients.
local ttl_seconds = math.ceil(capacity / refill_rate) + 60
redis.call('EXPIRE', key, ttl_seconds)

return { allowed, tokens }
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export interface RateLimitOptions {
  /** Unique identifier for the caller: API key id, user id, or IP address. */
  identifier: string;
  /** Logical bucket name so different endpoints get independent limits, e.g. "redirect", "create-link". */
  bucket: string;
  /** Max tokens the bucket can hold (i.e. max burst size). */
  capacity: number;
  /** Sustained requests-per-minute rate; converted internally to tokens/sec. */
  perMinute: number;
}

export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const key = `ratelimit:${opts.bucket}:${opts.identifier}`;
  const refillRate = opts.perMinute / 60;
  const now = Date.now();

  const result = (await redis.eval(TOKEN_BUCKET_SCRIPT, 1, key, opts.capacity, refillRate, now, 1)) as [
    number,
    string,
  ];

  return {
    allowed: result[0] === 1,
    remaining: Math.floor(Number(result[1])),
  };
}
