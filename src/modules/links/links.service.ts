import { config } from '../../config/index.js';
import { generateShortCode, validateCustomAlias } from '../../lib/shortcode.js';
import { validateDestinationUrl, UrlValidationError } from '../../lib/url-validator.js';
import { hashPassword } from '../auth/auth.service.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import * as repo from './links.repository.js';
import type { LinkRow } from './links.repository.js';
import type { CreateLinkInput, UpdateLinkInput } from './links.schema.js';
import { invalidateCache } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * UrlValidationError is a plain Error (see lib/url-validator.ts) rather
 * than an AppError, deliberately: the validator is a low-level, reusable
 * module that shouldn't need to know about this app's HTTP error
 * hierarchy. It's this service layer's job to translate it into a
 * ValidationError (422) that the global error handler knows how to map —
 * without this translation, it would fall through to a generic 500,
 * which is exactly the bug integration testing caught here.
 */
async function validateDestinationOrThrow(url: string): Promise<string> {
  try {
    const { normalized } = await validateDestinationUrl(url, { ownDomains: config.shortlinkDomains });
    return normalized;
  } catch (err) {
    if (err instanceof UrlValidationError) {
      throw new ValidationError(err.message, { code: err.code });
    }
    throw err;
  }
}

export async function createLink(
  userId: string | null,
  input: CreateLinkInput,
  idempotencyKey: string | null = null
): Promise<LinkRow> {
  // Idempotency: if the client already has a link stored under this key
  // (retried request after a network timeout, etc.), the route handler
  // checks getExistingByIdempotencyKey() BEFORE calling this function and
  // short-circuits — so by the time we get here we know it's genuinely new.

  // Validate destination URL — SSRF guard, scheme allowlist, self-referential check.
  const normalized = await validateDestinationOrThrow(input.url);

  // 3. Resolve the short code.
  let shortCode: string;
  let isCustomAlias = false;

  if (input.customAlias) {
    const validation = validateCustomAlias(input.customAlias);
    if (!validation.valid) {
      throw new ValidationError(validation.reason);
    }
    shortCode = input.customAlias;
    isCustomAlias = true;
  } else {
    // Placeholder; real value assigned after we reserve the id below.
    shortCode = '';
  }

  const passwordHash = input.password ? await hashPassword(input.password) : null;

  // Reserve the numeric id up front so a generated (non-custom) short code
  // can be derived from it before the row is inserted (see
  // links.repository.ts reserveNextLinkId for why this two-step approach
  // is necessary).
  const id = await repo.reserveNextLinkId();
  if (!isCustomAlias) {
    shortCode = generateShortCode(id, config.shortcodeSecret);
  }

  try {
    const link = await repo.insertLink({
      id,
      userId,
      shortCode,
      destinationUrl: normalized,
      isCustomAlias,
      passwordHash,
      maxClicks: input.maxClicks ?? null,
      expiresAt: input.expiresAt ?? null,
      redirectType: input.redirectType,
      tags: input.tags ?? [],
      title: input.title ?? null,
      idempotencyKey,
    });
    return link;
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        isCustomAlias
          ? `The alias "${shortCode}" is already taken. Please choose another.`
          : 'A short code collision occurred; please retry the request.'
      );
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

export async function getExistingByIdempotencyKey(userId: string, key: string): Promise<LinkRow | null> {
  return repo.findByIdempotencyKey(userId, key);
}

export async function updateLink(userId: string, shortCode: string, input: UpdateLinkInput): Promise<LinkRow> {
  const existing = await repo.findOwnedByShortCode(userId, shortCode);
  if (!existing) {
    throw new ConflictError('Link not found or not owned by this account.');
  }

  let destinationUrl: string | undefined;
  if (input.destinationUrl) {
    destinationUrl = await validateDestinationOrThrow(input.destinationUrl);
  }

  const updated = await repo.updateLink(existing.id, {
    destinationUrl,
    status: input.status,
    expiresAt: input.expiresAt,
    maxClicks: input.maxClicks,
    tags: input.tags,
    title: input.title,
  });

  if (!updated) {
    throw new ConflictError('Link not found or was deleted concurrently.');
  }

  // Invalidate the redirect cache immediately — otherwise the old
  // destination/status would keep serving from Redis until TTL expiry,
  // which is surprising for an "edit link" feature.
  await invalidateCache(`redirect:${shortCode}`).catch((err) =>
    logger.warn({ err, shortCode }, 'Failed to invalidate redirect cache after update')
  );

  return updated;
}

export async function deleteLink(userId: string, shortCode: string): Promise<void> {
  const existing = await repo.findOwnedByShortCode(userId, shortCode);
  if (!existing) {
    throw new ConflictError('Link not found or not owned by this account.');
  }
  await repo.softDeleteLink(existing.id);
  await invalidateCache(`redirect:${shortCode}`).catch((err) =>
    logger.warn({ err, shortCode }, 'Failed to invalidate redirect cache after delete')
  );
}
