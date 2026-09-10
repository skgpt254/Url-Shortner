import type pg from 'pg';
import { pool } from '../../db/client.js';

export interface LinkRow {
  id: string;
  user_id: string | null;
  short_code: string;
  domain_id: string | null;
  destination_url: string;
  is_custom_alias: boolean;
  status: 'active' | 'disabled' | 'expired' | 'pending_review' | 'blocked';
  password_hash: string | null;
  max_clicks: number | null;
  click_count: string; // bigint comes back as string from pg
  expires_at: string | null;
  redirect_type: number;
  tags: string[];
  title: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Reserves the next value of the links.id sequence WITHOUT inserting a row.
 * This lets us compute the Feistel-permuted short code (which is a
 * deterministic function of the numeric id — see lib/shortcode.ts) BEFORE
 * the insert, so the code can be part of the INSERT itself rather than a
 * follow-up UPDATE. Using pg_get_serial_sequence rather than hardcoding
 * 'links_id_seq' keeps this correct even if the identity column's
 * underlying sequence is ever renamed.
 */
export async function reserveNextLinkId(client: pg.PoolClient | pg.Pool = pool): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT nextval(pg_get_serial_sequence('links', 'id')) AS id`
  );
  return Number(rows[0]!.id);
}

export interface InsertLinkParams {
  id: number;
  userId: string | null;
  shortCode: string;
  destinationUrl: string;
  isCustomAlias: boolean;
  passwordHash: string | null;
  maxClicks: number | null;
  expiresAt: string | null;
  redirectType: number;
  tags: string[];
  title: string | null;
  idempotencyKey: string | null;
}

/**
 * Uniqueness for short_code is enforced at the DB level by two partial
 * unique indexes (links_code_default_domain_uidx / links_code_custom_domain_uidx
 * — see migration 001_init.sql for why this is split in two rather than one
 * index). The application-level check-then-insert is only a fast-path
 * optimization to give a friendly error without waiting for a DB
 * round-trip failure. Concurrent requests racing for the same alias are
 * still correctly resolved by the unique index (one wins, one gets a
 * unique_violation we translate to ConflictError in the service layer).
 *
 * `id` must come from reserveNextLinkId() — we insert it explicitly
 * (OVERRIDING SYSTEM VALUE) rather than letting IDENTITY auto-assign it,
 * because the short_code for non-custom-alias links is derived from this
 * exact id and must be computed before the row exists.
 */
export async function insertLink(params: InsertLinkParams, client: pg.PoolClient | pg.Pool = pool): Promise<LinkRow> {
  const { rows } = await client.query<LinkRow>(
    `INSERT INTO links (
       id, user_id, short_code, destination_url, is_custom_alias, password_hash,
       max_clicks, expires_at, redirect_type, tags, title, idempotency_key
     ) OVERRIDING SYSTEM VALUE
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      params.id,
      params.userId,
      params.shortCode,
      params.destinationUrl,
      params.isCustomAlias,
      params.passwordHash,
      params.maxClicks,
      params.expiresAt,
      params.redirectType,
      params.tags,
      params.title,
      params.idempotencyKey,
    ]
  );
  return rows[0]!;
}

export async function findByShortCode(shortCode: string): Promise<LinkRow | null> {
  const { rows } = await pool.query<LinkRow>(
    `SELECT * FROM links WHERE short_code = $1 AND domain_id IS NULL AND deleted_at IS NULL`,
    [shortCode]
  );
  return rows[0] ?? null;
}

export async function findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<LinkRow | null> {
  const { rows } = await pool.query<LinkRow>(
    `SELECT * FROM links WHERE user_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL`,
    [userId, idempotencyKey]
  );
  return rows[0] ?? null;
}

export async function findOwnedByShortCode(userId: string, shortCode: string): Promise<LinkRow | null> {
  const { rows } = await pool.query<LinkRow>(
    `SELECT * FROM links WHERE short_code = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [shortCode, userId]
  );
  return rows[0] ?? null;
}

export interface ListLinksParams {
  userId: string;
  limit: number;
  cursorCreatedAt?: string;
  tag?: string;
  status?: string;
}

export async function listLinksForUser(params: ListLinksParams): Promise<LinkRow[]> {
  const conditions: string[] = ['user_id = $1', 'deleted_at IS NULL'];
  const values: unknown[] = [params.userId];

  if (params.cursorCreatedAt) {
    values.push(params.cursorCreatedAt);
    conditions.push(`created_at < $${values.length}`);
  }
  if (params.tag) {
    values.push(params.tag);
    conditions.push(`$${values.length} = ANY(tags)`);
  }
  if (params.status) {
    values.push(params.status);
    conditions.push(`status = $${values.length}`);
  }

  values.push(params.limit);
  const { rows } = await pool.query<LinkRow>(
    `SELECT * FROM links WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  );
  return rows;
}

export interface UpdateLinkFields {
  destinationUrl?: string;
  status?: string;
  expiresAt?: string | null;
  maxClicks?: number | null;
  tags?: string[];
  title?: string | null;
}

export async function updateLink(id: string, fields: UpdateLinkFields): Promise<LinkRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, col] of [
    ['destinationUrl', 'destination_url'],
    ['status', 'status'],
    ['expiresAt', 'expires_at'],
    ['maxClicks', 'max_clicks'],
    ['tags', 'tags'],
    ['title', 'title'],
  ] as const) {
    if (key in fields && fields[key] !== undefined) {
      values.push(fields[key]);
      setClauses.push(`${col} = $${values.length}`);
    }
  }

  if (setClauses.length === 0) {
    const { rows } = await pool.query<LinkRow>('SELECT * FROM links WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  values.push(id);
  const { rows } = await pool.query<LinkRow>(
    `UPDATE links SET ${setClauses.join(', ')} WHERE id = $${values.length} AND deleted_at IS NULL RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function softDeleteLink(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE links SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [
    id,
  ]);
  return (rowCount ?? 0) > 0;
}

/**
 * Atomically increments the click counter and, if a max_clicks cap is set
 * and would be exceeded, flips status to 'disabled' in the same statement
 * — avoiding a separate read-modify-write race where two concurrent clicks
 * could both pass a "clicks < max" check before either write lands.
 */
export async function incrementClickCountAndCheckLimit(id: string): Promise<{ withinLimit: boolean }> {
  const { rows } = await pool.query<{ within_limit: boolean }>(
    `UPDATE links
        SET click_count = click_count + 1,
            status = CASE
                       WHEN max_clicks IS NOT NULL AND click_count + 1 >= max_clicks THEN 'disabled'
                       ELSE status
                     END
      WHERE id = $1
      RETURNING (max_clicks IS NULL OR click_count <= max_clicks) AS within_limit`,
    [id]
  );
  return { withinLimit: rows[0]?.within_limit ?? false };
}
