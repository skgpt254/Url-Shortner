-- ============================================================================
-- Migration 001: Initial schema
-- ============================================================================
-- Design notes:
--  * All primary keys are BIGINT identity, not UUID. Short links are created
--    at high frequency and we need a compact, index-friendly, monotonically
--    increasing key to feed the short-code generator (see lib/shortcode.ts).
--    UUIDs would also work but fragment btree indexes (random insert order)
--    and bloat every foreign key reference; bigint sequences don't.
--  * `links.short_code` is UNIQUE and is what the redirect hot-path looks up
--    by. It is NOT the primary key lookup path for anything else, so we
--    still keep `id` as the FK target elsewhere.
--  * click_events is a partitioned table (by month) because it is an
--    append-only, unbounded-growth table that dominates storage over time.
--    Partitioning lets us drop old partitions in O(1) instead of DELETE.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Users ────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email           CITEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Bumped on password change / explicit "log out everywhere". Refresh
    -- tokens embed the version at issue time; a mismatch invalidates them
    -- without needing a server-side token blocklist.
    token_version   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- (email uses CITEXT for case-insensitive uniqueness/lookups; extension loaded above)

CREATE UNIQUE INDEX users_email_uidx ON users (email);

-- ── API keys ─────────────────────────────────────────────────────────────
-- We never store the raw key. Only a SHA-256 hash of the secret half.
-- The key itself is `${prefix}_${secret}` so we can look up by prefix
-- (indexed, cheap) then verify the secret hash (constant-time compare).
CREATE TABLE api_keys (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    key_prefix      TEXT NOT NULL,
    secret_hash     TEXT NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT ARRAY['links:read', 'links:write'],
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX api_keys_prefix_uidx ON api_keys (key_prefix);
CREATE INDEX api_keys_user_idx ON api_keys (user_id) WHERE revoked_at IS NULL;

-- ── Custom / branded domains ─────────────────────────────────────────────
CREATE TABLE domains (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hostname        TEXT NOT NULL,
    verified_at     TIMESTAMPTZ,
    verification_token TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX domains_hostname_uidx ON domains (hostname);

-- ── Links ────────────────────────────────────────────────────────────────
CREATE TABLE links (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             BIGINT REFERENCES users(id) ON DELETE SET NULL,
    short_code          TEXT NOT NULL,
    domain_id           BIGINT REFERENCES domains(id) ON DELETE SET NULL,
    destination_url     TEXT NOT NULL,
    is_custom_alias     BOOLEAN NOT NULL DEFAULT FALSE,

    -- lifecycle / moderation
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'disabled', 'expired', 'pending_review', 'blocked')),

    -- optional protections
    password_hash       TEXT,                    -- argon2 hash, NULL = no password
    max_clicks          INTEGER,                 -- NULL = unlimited
    click_count         BIGINT NOT NULL DEFAULT 0,
    expires_at          TIMESTAMPTZ,              -- NULL = never

    -- redirect behavior
    redirect_type       SMALLINT NOT NULL DEFAULT 302 CHECK (redirect_type IN (301, 302, 307, 308)),

    -- organization
    tags                TEXT[] NOT NULL DEFAULT '{}',
    title               TEXT,

    -- idempotency support for POST /links
    idempotency_key     TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

-- The redirect hot path does: WHERE short_code = $1 AND domain_id = $2
-- AND deleted_at IS NULL. We need TWO partial unique indexes here, not one:
-- Postgres unique indexes treat NULL <> NULL (two NULLs are never
-- considered duplicates), so a single UNIQUE INDEX on (short_code,
-- domain_id) would silently fail to enforce uniqueness for every link
-- that has no custom domain — which is the common case, since custom
-- branded domains are an optional feature. Splitting into "no domain"
-- and "has domain" cases makes both paths correctly enforce uniqueness.
CREATE UNIQUE INDEX links_code_default_domain_uidx
    ON links (short_code)
    WHERE domain_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX links_code_custom_domain_uidx
    ON links (short_code, domain_id)
    WHERE domain_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX links_user_idx ON links (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX links_idempotency_idx ON links (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX links_expires_idx ON links (expires_at) WHERE expires_at IS NOT NULL AND status = 'active';
CREATE INDEX links_tags_gin_idx ON links USING GIN (tags);

-- ── Click events (partitioned by month, append-only) ────────────────────
CREATE TABLE click_events (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    link_id         BIGINT NOT NULL,
    clicked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_hash         TEXT,                 -- SHA-256(ip + salt), never raw IP
    country_code    CHAR(2),
    city            TEXT,
    device_type     TEXT,                 -- mobile | desktop | tablet | bot | unknown
    browser         TEXT,
    os              TEXT,
    referrer_host   TEXT,
    is_bot          BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id, clicked_at)
) PARTITION BY RANGE (clicked_at);

CREATE INDEX click_events_link_idx ON click_events (link_id, clicked_at DESC);

-- Bootstrap partitions for the current and next 2 months. The migration
-- runner / a cron job (scripts/create-partitions.ts) creates future
-- partitions ahead of time; see README "Operational runbooks".
DO $$
DECLARE
    start_date date := date_trunc('month', now());
    part_date date;
    part_name text;
BEGIN
    FOR i IN 0..2 LOOP
        part_date := start_date + (i || ' month')::interval;
        part_name := 'click_events_' || to_char(part_date, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF click_events FOR VALUES FROM (%L) TO (%L);',
            part_name, part_date, part_date + interval '1 month'
        );
    END LOOP;
END $$;

-- ── Daily rollups (fast dashboard reads; populated by worker) ───────────
CREATE TABLE click_daily_rollup (
    link_id         BIGINT NOT NULL,
    day             DATE NOT NULL,
    clicks          BIGINT NOT NULL DEFAULT 0,
    unique_visitors BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (link_id, day)
);

CREATE INDEX click_daily_rollup_link_idx ON click_daily_rollup (link_id, day DESC);

-- ── Audit log (security-relevant actions) ───────────────────────────────
CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    target_type     TEXT NOT NULL,
    target_id       TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    ip_hash         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC);

-- ── updated_at trigger helper ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER links_set_updated_at BEFORE UPDATE ON links
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
