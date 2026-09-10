import { config } from '../../config/index.js';
import { getOrSetCache } from '../../lib/cache.js';
import { GoneError, NotFoundError, ForbiddenError } from '../../lib/errors.js';
import * as linksRepo from '../../modules/links/links.repository.js';
import { verifyPassword } from '../auth/auth.service.js';
import { enqueueClickEvent } from '../../queue/click-queue.js';
import { logger } from '../../lib/logger.js';

/**
 * Only the fields actually needed to serve a redirect are cached — not the
 * full LinkRow. Keeping the cached payload small matters at scale (Redis
 * memory, network payload per request) and also means a cache entry
 * doesn't go stale in ways unrelated to redirecting (e.g. tag edits don't
 * need to invalidate this cache; only redirect-relevant field changes do,
 * see links.service.ts's invalidateCache calls on update/delete).
 */
interface CachedLinkEntry {
  id: string;
  destinationUrl: string;
  status: string;
  passwordProtected: boolean;
  expiresAt: string | null;
  redirectType: number;
  hasClickLimit: boolean;
}

function toCacheEntry(link: linksRepo.LinkRow): CachedLinkEntry {
  return {
    id: link.id,
    destinationUrl: link.destination_url,
    status: link.status,
    passwordProtected: link.password_hash !== null,
    expiresAt: link.expires_at,
    redirectType: link.redirect_type,
    hasClickLimit: link.max_clicks !== null,
  };
}

export interface ResolveRedirectContext {
  ip: string;
  userAgent: string | null;
  referrer: string | null;
  /** Password supplied by the visitor, if this link is password-protected (from the interstitial form). */
  suppliedPassword?: string;
}

export interface ResolvedRedirect {
  destinationUrl: string;
  redirectType: number;
}

/**
 * Resolves a short code to its destination, enforcing all link-level
 * policies (expiry, disabled/blocked status, password, click cap), and
 * fires off async click tracking. This function is on the critical path
 * for EVERY redirect request, so:
 *   - the common case (active, unprotected, unexpired link) does exactly
 *     one Redis GET and zero Postgres queries (cache populated on first
 *     miss, see getOrSetCache).
 *   - click tracking is enqueued, never awaited inline.
 */
export async function resolveRedirect(shortCode: string, ctx: ResolveRedirectContext): Promise<ResolvedRedirect> {
  const cacheKey = `redirect:${shortCode}`;

  const entry = await getOrSetCache<CachedLinkEntry>(cacheKey, config.redis.cacheTtlSeconds, async () => {
    const link = await linksRepo.findByShortCode(shortCode);
    return link ? toCacheEntry(link) : null;
  });

  if (!entry) {
    throw new NotFoundError('This short link does not exist.');
  }

  if (entry.status === 'blocked') {
    throw new GoneError('This link has been blocked for violating our terms of service.');
  }
  if (entry.status === 'disabled') {
    throw new GoneError('This link has been disabled by its owner.');
  }
  if (entry.status === 'pending_review') {
    throw new GoneError('This link is pending a safety review and is temporarily unavailable.');
  }
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() < Date.now()) {
    throw new GoneError('This link has expired.');
  }

  if (entry.passwordProtected) {
    if (!ctx.suppliedPassword) {
      // Signal to the route layer to render the password-prompt page
      // instead of redirecting. We don't throw a generic error here
      // because "needs a password" is an expected, first-class flow, not
      // a failure — see redirect.routes.ts for how PasswordRequiredError
      // is caught and handled distinctly from real errors.
      throw new PasswordRequiredError();
    }
    // Password verification requires the actual hash, which we deliberately
    // do NOT cache (a password hash sitting in Redis is a needlessly larger
    // attack surface than one sitting only in Postgres behind normal DB
    // access controls). This is the one path that still hits the DB.
    const link = await linksRepo.findByShortCode(shortCode);
    if (!link?.password_hash || !(await verifyPassword(link.password_hash, ctx.suppliedPassword))) {
      throw new ForbiddenError('Incorrect password.');
    }
  }

  // Click-limit enforcement is atomic at the DB level (see
  // incrementClickCountAndCheckLimit) to avoid a race where two concurrent
  // requests both read "clicks < max" before either write lands. We only
  // pay this DB round-trip cost for links that actually HAVE a cap.
  if (entry.hasClickLimit) {
    const { withinLimit } = await linksRepo.incrementClickCountAndCheckLimit(entry.id);
    if (!withinLimit) {
      throw new GoneError('This link has reached its maximum number of clicks.');
    }
  } else {
    // Fire-and-forget increment for uncapped links — accuracy of the raw
    // counter here is best-effort (the daily rollup table, populated by
    // the click-events worker, is the source of truth for analytics).
    linksRepo.incrementClickCountAndCheckLimit(entry.id).catch((err) => {
      logger.warn({ err, shortCode }, 'Non-blocking click-count increment failed');
    });
  }

  enqueueClickEvent({
    linkId: entry.id,
    clickedAt: new Date().toISOString(),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    referrer: ctx.referrer,
  });

  return { destinationUrl: entry.destinationUrl, redirectType: entry.redirectType };
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('This link requires a password.');
    this.name = 'PasswordRequiredError';
  }
}
