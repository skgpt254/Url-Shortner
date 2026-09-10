import 'dotenv/config';
import { z } from 'zod';

/**
 * We validate all env vars with zod at process startup and crash immediately
 * with a clear message if anything is missing/malformed. This is deliberate:
 * a misconfigured JWT secret or missing DATABASE_URL should never surface as
 * a confusing runtime error three requests into production traffic.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SHORTLINK_DOMAINS: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  // Comma-separated list of origins allowed to call the API with
  // credentials in production — the frontend's own origin(s). Defaults to
  // PUBLIC_BASE_URL alone if unset, but almost every real deployment
  // (including the local docker-compose stack, where the frontend is on
  // its own port) needs this set explicitly.
  ALLOWED_ORIGINS: z.string().optional().default(''),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DATABASE_SSL: z.preprocess(
    // z.coerce.boolean() would naively do JS's Boolean(value), and
    // Boolean("false") is true (any non-empty string is truthy) — that
    // bug once caused DATABASE_SSL=false in a real .env file to actually
    // enable SSL and break local/Docker Postgres connections that don't
    // support it. Parse the literal string content instead.
    (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : Boolean(v)),
    z.boolean()
  ).default(false),

  REDIS_URL: z.string().min(1),
  REDIS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  SHORTCODE_SECRET: z.string().min(32, 'SHORTCODE_SECRET must be >= 32 chars'),

  RATE_LIMIT_ANONYMOUS_PER_MIN: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_AUTHENTICATED_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_REDIRECT_PER_MIN: z.coerce.number().int().positive().default(1000),

  GOOGLE_SAFE_BROWSING_API_KEY: z.string().optional().default(''),
  SENTRY_DSN: z.string().optional().default(''),

  CLICK_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  IP_HASH_SALT: z.string().min(8),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  host: env.HOST,
  logLevel: env.LOG_LEVEL,

  publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
  shortlinkDomains: new Set(env.SHORTLINK_DOMAINS.split(',').map((d) => d.trim().toLowerCase())),
  allowedOrigins: env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [env.PUBLIC_BASE_URL.replace(/\/$/, '')],

  db: {
    url: env.DATABASE_URL,
    poolMax: env.DATABASE_POOL_MAX,
    idleTimeoutMs: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
    ssl: env.DATABASE_SSL,
  },

  redis: {
    url: env.REDIS_URL,
    cacheTtlSeconds: env.REDIS_CACHE_TTL_SECONDS,
  },

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  },

  shortcodeSecret: env.SHORTCODE_SECRET,

  rateLimit: {
    anonymousPerMin: env.RATE_LIMIT_ANONYMOUS_PER_MIN,
    authenticatedPerMin: env.RATE_LIMIT_AUTHENTICATED_PER_MIN,
    redirectPerMin: env.RATE_LIMIT_REDIRECT_PER_MIN,
  },

  safeBrowsingApiKey: env.GOOGLE_SAFE_BROWSING_API_KEY || null,
  sentryDsn: env.SENTRY_DSN || null,

  clickEventRetentionDays: env.CLICK_EVENT_RETENTION_DAYS,
  ipHashSalt: env.IP_HASH_SALT,
} as const;

export type AppConfig = typeof config;
