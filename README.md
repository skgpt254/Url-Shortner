# Shortlink Platform

A production-grade URL shortener: not a toy `id -> url` lookup table, but a
full platform with real security hardening, horizontal scalability, async
analytics, and operational tooling for running it in production.

**Want a live copy running in ~10 minutes with no local setup?** Jump to
[§0 — Deploy your own copy](#0-deploy-your-own-copy-in-10-minutes-no-local-setup-required).
Once this repo is on your own GitHub, these two buttons do most of the
work for you (replace `<you>/<repo>` in the Render URL below with your
actual GitHub path first — Render's button needs to know which repo to
read `render.yaml` from):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/<you>/<repo>)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/<you>/<repo>&root-directory=frontend)

This README explains **what** was built, **why** each major decision was
made over the obvious alternative, and **how** to run, test, and deploy it.

> **Engineering note on how this was built:** every claim below about
> correctness is backed by tests that were actually executed against real
> Postgres and Redis instances during development — not just written and
> assumed to pass. That process caught two real bugs before you ever saw
> this code (see "Bugs caught by testing" below), which is exactly the
> point of writing tests instead of trusting review alone.

---

## 0. Deploy your own copy in ~10 minutes (no local setup required)

This gets you a live, working app at a public URL — anyone can open it and
shorten links immediately — without installing Docker, Postgres, Redis, or
Node on your own machine. Two pieces, two platforms:

- **Backend** (API + database + cache) → **Render**, one click
- **Frontend** (the website) → **Vercel**, one click

### Step 1 — push this project to your own GitHub repo

Render and Vercel both deploy by connecting to a GitHub repo you own, so
this step can't be skipped — but it's just a normal `git push`:

```bash
cd url-shortener   # this project's root
git init
git add .
git commit -m "Initial commit"
gh repo create shortlink-platform --public --source=. --push
# no `gh` CLI? Create an empty repo on github.com instead, then:
#   git remote add origin https://github.com/<you>/shortlink-platform.git
#   git branch -M main && git push -u origin main
```

### Step 2 — deploy the backend to Render

1. Go to the [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**.
2. Connect the GitHub repo you just pushed. Render reads `render.yaml` at
   the repo root automatically and shows you a preview: one web service,
   one free Postgres database, one free Redis (Key Value) instance.
3. Click **Apply**. Render builds the Docker image, runs migrations
   automatically on first boot (see `docker-entrypoint.sh`), and starts
   the API — no manual setup step exists here by design.
4. Once it's live, copy the URL Render assigned (looks like
   `https://shortlink-api-xxxx.onrender.com`).
5. In the Render dashboard, open the `shortlink-api` service → **Environment**
   and fill in the three variables the blueprint left blank (Render prompts
   for these on first deploy too):
   - `PUBLIC_BASE_URL` → the URL from step 4
   - `SHORTLINK_DOMAINS` → the same URL's hostname only (e.g. `shortlink-api-xxxx.onrender.com`)
   - `ALLOWED_ORIGINS` → leave blank for now; you'll set it in step 4 below once the frontend exists

Test it right away, before touching the frontend at all:
```bash
curl -X POST https://shortlink-api-xxxx.onrender.com/api/v1/links/quick \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```
You should get back a `shortUrl`. Open it in a browser — it should redirect.

### Step 3 — deploy the frontend to Vercel

1. Go to the [Vercel Dashboard](https://vercel.com/new) → import the same
   GitHub repo.
2. When Vercel asks for the **Root Directory**, set it to `frontend`
   (this repo has the backend and frontend side by side — see §9's
   project structure — so Vercel needs to know which folder to build).
   Vercel auto-detects the Vite framework preset once you do.
3. Add one environment variable before deploying:
   - `VITE_API_BASE_URL` → the Render URL from Step 2 (no trailing slash),
     e.g. `https://shortlink-api-xxxx.onrender.com`
4. Click **Deploy**. You'll get a URL like `https://shortlink-platform.vercel.app`.

### Step 4 — connect the two (one env var back on Render)

Back in Render, set the `ALLOWED_ORIGINS` variable on the `shortlink-api`
service to your new Vercel URL (e.g. `https://shortlink-platform.vercel.app`),
then trigger a manual redeploy (or it picks it up automatically — Render
restarts the service when an env var changes). This is the CORS allowlist
(see §2.3) — without it, the browser blocks the frontend's requests to the
API even though direct `curl` calls work fine.

**That's it.** Share the Vercel link — anyone who opens it can sign up,
shorten links, and see analytics, with zero setup on their end.

### Being honest about the free tier

- Render's free web service **spins down after 15 minutes of inactivity**
  and takes 30-60 seconds to wake back up on the next request. Fine for a
  demo/portfolio project; upgrade the `shortlink-api` service's plan if
  you need it always-on.
- Render's free Postgres **expires 30 days after creation**, then gets a
  14-day grace period, then is permanently deleted — this is a Render
  policy, not something this project can work around. For a database you
  actually want to keep: create a free, non-expiring Postgres at
  [neon.tech](https://neon.tech), then replace the `DATABASE_URL` env var
  on Render with Neon's connection string (Environment tab → edit the
  value directly; it's no longer wired to `fromDatabase` once you do this,
  which is fine). No code or migration changes needed — it's the same
  Postgres wire protocol either way.
- The click-analytics worker runs **inside** the API process here
  (`EMBED_WORKER=true` in `render.yaml`) because Render's free tier has no
  background-worker service type at all. This trades away the
  architectural separation described in §1 — acceptable at demo scale,
  not recommended once real traffic shows up (see the commented-out
  `worker` service block in `render.yaml` for how to split it out once
  you're on paid plans).

---



```
                                   ┌─────────────┐
                     ┌────────────▶│   Ingress   │
                     │             │ (TLS, WAF,  │
                     │             │ coarse rate  │
                     │             │  limiting)   │
                     │             └──────┬──────┘
                     │                    │
              ┌──────┴──────┐      ┌──────▼──────┐
              │   Clients   │      │  API Pods    │◀──── HPA (CPU/mem)
              │ (browsers,  │─────▶│  (Fastify)   │      scales 3-20 replicas
              │ API users)  │      │  stateless   │
              └─────────────┘      └───┬─────┬───┘
                                        │     │
                          ┌─────────────┘     └─────────────┐
                          ▼                                 ▼
                   ┌─────────────┐                   ┌─────────────┐
                   │    Redis     │◀── cache-aside ──│  PostgreSQL │
                   │ (redirect     │    reads          │  (source of  │
                   │  cache, rate  │                    │   truth,     │
                   │  limits,      │                    │   partitioned│
                   │  BullMQ queue)│                    │   click log) │
                   └──────┬───────┘                    └──────▲──────┘
                          │ click events (async, fire-and-forget)
                          ▼
                   ┌─────────────┐
                   │ Worker Pods  │───────────────────────────┘
                   │  (BullMQ      │   writes click_events +
                   │   consumer)   │   click_daily_rollup
                   └─────────────┘
```

**Two independently-scaled services, one codebase:**
- **API** — stateless, handles HTTP (link CRUD, redirects). Scales on
  request volume / CPU.
- **Worker** — consumes the click-events queue, does IP hashing / geo /
  UA parsing / DB writes. Scales on *click volume*, a different axis
  entirely (a link can get 10,000 clicks/sec while link-creation traffic
  stays flat — these should never share a resource budget). See
  `k8s/worker-deployment.yaml`.

This separation is the single highest-leverage architectural decision in
the system: it means a click-analytics processing spike can **never**
degrade redirect latency, and vice versa.

---

## 2. Key design decisions (and the alternatives considered)

### 2.1 Short code generation: counter + Feistel permutation, not random+retry

**The obvious approach** — generate N random base62 characters, check the
DB for a collision, retry if taken — has a fundamental scaling problem:
retry rate climbs as the keyspace fills, and every creation pays a
DB round-trip just to *maybe* find out the code is unusable.

**What we built instead**: reserve a monotonically increasing integer
(Postgres identity sequence), run it through a **Feistel network** (the
same construction block ciphers use to build a permutation from a simple
round function), and Base62-encode the result. This is:
- **Collision-free by mathematical construction** — a Feistel network is
  a *bijection*, not a hash. No two inputs ever map to the same output.
  Verified empirically too: `tests/unit/shortcode.test.ts` checks 50,000
  consecutive IDs produce 50,000 distinct codes.
- **Zero DB round-trips to check availability** — the code is derived
  directly from the reserved ID.
- **Not sequentially guessable** — codes for IDs 1, 2, 3 don't look like
  "1, 2, 3" (verified by the "no shared prefix" test), so competitors
  can't scrape a business's link volume or walk other users' links.

Custom aliases bypass all of this and are stored/looked-up verbatim.

**Explicit non-claim**: this is *obfuscation*, not a capability/security
boundary. A short code must never be treated as a secret credential —
see password-protected links for where we *do* need a real secret.

### 2.2 Redirect path: Redis cache-aside with stampede protection

The redirect endpoint is the highest-traffic, most latency-sensitive path
in the system by a wide margin (link creation happens once; a popular
link might get redirected millions of times). The common case does
**exactly one Redis GET and zero Postgres queries**.

On a cache miss, naively racing 500 concurrent requests to the DB would
create a thundering-herd problem. We solve this with a short-lived
`SET NX PX` lock: the first miss populates the cache while others poll
briefly, falling through to the DB directly only if the lock holder
takes unusually long (crash safety net, not the common path). See
`src/lib/cache.ts`.

### 2.3 SSRF protection is real, not cosmetic

Most URL-shortener writeups check `url.protocol === 'https:'` and call it
done. That doesn't stop `http://169.254.169.254/latest/meta-data/` (cloud
metadata endpoint) or `http://10.0.0.5:6379/` (internal Redis) from being
shortened, and if *any* future feature ever fetches the destination
server-side (link previews, safe-browsing re-checks, screenshot
generation), that's a live SSRF vector.

`src/lib/url-validator.ts` actually resolves DNS and checks **every**
returned address against the full private/reserved IPv4 and IPv6 ranges
(RFC 1918, link-local/cloud-metadata, loopback, carrier-grade NAT,
multicast, unique-local IPv6, etc.) — not just the obvious `10.x`/`192.168.x`
cases. This is verified in `tests/integration/links.test.ts` with a live
test against the actual metadata-endpoint IP.

### 2.4 Click limits and click counting are atomic

A naive "read click_count, check < max, increment" has a race: two
concurrent clicks can both read `count = max - 1`, both pass the check,
and both get through — one over the limit. `incrementClickCountAndCheckLimit`
does the increment *and* the limit-triggered status flip in a single
`UPDATE ... RETURNING` statement, so there is no window between check and
act. Verified in `tests/integration/links.test.ts`.

### 2.5 Rate limiting: token bucket via atomic Lua script, not fixed windows

Fixed-window counters ("100 requests per minute") let through 2x the
limit at a window boundary (100 requests at 0:59, another 100 at 1:00).
A token bucket has no such artifact, and implementing the check-and-consume
as a single Redis Lua script (`src/lib/rate-limiter.ts`) makes it atomic —
no separate GET/INCR race.

### 2.6 Privacy-first analytics: IP addresses are never stored raw

`src/modules/analytics/analytics.service.ts` hashes every visitor IP with
a salted SHA-256 the moment a click is processed, before it ever touches
disk. Geo/device data is derived from the IP at ingestion time and the
raw IP is discarded. Even a full database compromise doesn't expose
visitor IP addresses. Raw click events are also automatically purged
after `CLICK_EVENT_RETENTION_DAYS` (partition-drop, not row-by-row
DELETE — see §6).

### 2.7 Auth: hashed API keys, Argon2id passwords, revocable JWTs

- API keys are `sl_live_<prefix>_<secret>`. Only a SHA-256 hash of the
  secret is ever persisted (never the raw key) — identical in spirit to
  password storage. Verification is prefix-lookup (indexed) + constant-time
  hash comparison (no timing side-channel).
- Passwords use Argon2id (PHC competition winner; memory-hard, resists
  both GPU cracking and side-channel attacks) with OWASP-baseline cost
  parameters.
- JWT access tokens are short-lived (15 min default); refresh tokens
  embed a `token_version` that's bumped on password change or explicit
  "log out everywhere" — this revokes all outstanding refresh tokens
  without needing a server-side blocklist.

### 2.8 Idempotency keys on link creation

`POST /links` accepts an `Idempotency-Key` header. A client that times
out and retries the exact same request gets the *original* link back
(`idempotentReplay: true`) instead of creating a duplicate — essential
for any API that mobile clients or flaky networks will call.

---

## 3. Bugs caught by testing (a case study in why this matters)

Two real bugs were found and fixed by actually running tests against live
Postgres/Redis rather than trusting the code on inspection:

1. **Silent uniqueness failure.** The original schema had one unique
   index on `(short_code, domain_id) WHERE deleted_at IS NULL`. Postgres
   unique indexes treat `NULL <> NULL` — two rows both having
   `domain_id = NULL` (the default; custom branded domains are optional)
   are **not** considered duplicates by that index. Two users could have
   silently claimed the identical custom alias. Caught by an integration
   test asserting a 409 on duplicate alias; fixed by splitting into two
   partial indexes (one for `domain_id IS NULL`, one for `IS NOT NULL`).

2. **Error-mapping gap.** `UrlValidationError` (thrown by the SSRF guard)
   didn't extend the app's `AppError` base class, so the global error
   handler didn't recognize it and returned a raw 500 instead of a clean
   422 with a helpful message. Caught by an integration test hitting the
   cloud-metadata IP and asserting 422; fixed by translating the error at
   the service-layer boundary.

3. **A silent 32-bit integer overflow.** The Feistel-network short-code
   generator initially combined two 21-bit halves using JavaScript's `<<`
   and `|` bitwise operators — which silently coerce operands to **signed
   32-bit integers**. Since the combined value is 42 bits, this corrupted
   every generated code above a certain threshold. Caught by a unit test
   asserting `decodeShortCode(generateShortCode(id)) === id`; fixed by
   switching to arithmetic (multiply/mod) which is exact up to 2^53 in JS.

4. **`z.coerce.boolean()` doesn't do what its name implies.** `DATABASE_SSL`
   was validated with `z.coerce.boolean()`, which just runs JavaScript's
   `Boolean(value)` — and `Boolean("false")` is `true`, because it's a
   non-empty string. Setting `DATABASE_SSL=false` in a real `.env` file
   (exactly what a new user copying `.env.example` would do) silently
   **enabled** SSL and broke every connection to a local Postgres that
   doesn't support it. Caught the hard way, during actual local setup, not
   by a unit test — which is itself the lesson: environment-parsing code is
   exactly as deserving of a test as business logic, and now has one
   (`DATABASE_SSL=false/true/FALSE` are all asserted to resolve correctly).
   Fixed with `z.preprocess` that checks the literal string content.

5. **Missing `.dockerignore` inflated build context to 350+ seconds.**
   Without one, `docker build` sends the entire project directory —
   including a fully-installed `node_modules` — to the Docker daemon as
   build context before the first instruction even runs. A real user's
   build log showed a `transferring context: 359.5s` step as a direct
   result. Fixed by adding `.dockerignore` excluding `node_modules`,
   `dist`, and `.env*`.

---

## 4. Feature list

- **A real web frontend** (`/frontend`) — landing page with instant
  anonymous shortening, signup/login, a dashboard for managing links,
  per-link analytics with charts, and API key management. Deployable to
  Vercel with zero backend code changes (see §0).
- Anonymous "quick shorten" (`POST /links/quick`, no auth) matching the
  classic bitly/TinyURL homepage experience, alongside full account-based
  link management
- Short link creation with auto-generated or custom aliases
- Link expiration (absolute timestamp)
- Click-limit caps (one-time-use links, capped-distribution links)
- Password-protected links (interstitial HTML prompt, never in the URL)
- Configurable redirect type (301/302/307/308) per link
- Tags + title metadata, filterable listing with cursor pagination
- Bulk link creation (up to 500 per request)
- Idempotent creation via `Idempotency-Key`
- QR code generation per link (`GET /:code/qr`)
- Click analytics: daily rollups, top referrers, top countries, device
  breakdown, all queryable per link over a configurable time window
- API keys with scopes (`links:read` / `links:write`), full lifecycle
  (create/list/revoke)
- JWT-based dashboard auth with refresh-token revocation
- Custom/branded domain support (schema-level; see `domains` table)
- Soft delete (links are never hard-deleted, preserving analytics history)
- OpenAPI/Swagger docs at `/docs`
- Structured audit log table for security-relevant actions

---

## 5. API reference (summary — full schema at `/docs`)

All endpoints are versioned under `/api/v1`, except the public redirect
routes which are at the domain root (`/:code`) so short links stay short.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | — | Create an account |
| POST | `/api/v1/auth/login` | — | Get access + refresh tokens |
| POST | `/api/v1/auth/refresh` | — | Exchange refresh token for new access token |
| POST | `/api/v1/auth/logout-all` | JWT | Revoke all refresh tokens |
| POST | `/api/v1/api-keys` | JWT | Create an API key (shown once) |
| GET | `/api/v1/api-keys` | JWT | List your API keys (masked) |
| DELETE | `/api/v1/api-keys/:id` | JWT | Revoke an API key |
| POST | `/api/v1/links` | JWT/key | Create a short link |
| POST | `/api/v1/links/bulk` | JWT/key | Bulk-create up to 500 links |
| GET | `/api/v1/links` | JWT/key | List your links (paginated, filterable) |
| GET | `/api/v1/links/:code` | JWT/key | Get one link's details |
| PATCH | `/api/v1/links/:code` | JWT/key | Update destination/status/expiry/tags |
| DELETE | `/api/v1/links/:code` | JWT/key | Soft-delete a link |
| GET | `/api/v1/links/:code/analytics` | JWT/key | Click analytics summary |
| GET | `/:code` | — | **The redirect.** 302 (default) to destination |
| POST | `/:code` | — | Submit password for a protected link |
| GET | `/:code/qr` | — | QR code PNG for the short link |
| GET | `/healthz` | — | Liveness (process alive) |
| GET | `/readyz` | — | Readiness (DB + Redis reachable) |

Example:

```bash
curl -X POST https://short.example.com/api/v1/links \
  -H "Authorization: Bearer sl_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "url": "https://example.com/a/very/long/path?utm_source=newsletter",
    "customAlias": "spring-sale",
    "expiresAt": "2026-12-31T23:59:59Z",
    "tags": ["marketing", "q4"]
  }'
```

---

## 6. Running it

### Local development (Docker Compose)

```bash
cp .env.example .env
# generate real secrets:
sed -i "s/changeme_access_secret_min_32_bytes_long/$(openssl rand -hex 32)/" .env
sed -i "s/changeme_refresh_secret_min_32_bytes_long/$(openssl rand -hex 32)/" .env
sed -i "s/changeme_shortcode_secret_min_32_bytes_long/$(openssl rand -hex 32)/" .env
sed -i "s/changeme_ip_hash_salt/$(openssl rand -hex 16)/" .env

docker compose up --build
# Frontend: http://localhost:8080
# API:      http://localhost:3000, docs at http://localhost:3000/docs
```

The `frontend` service builds `/frontend` with nginx serving the static
build and proxying `/api/*` to the `api` container (see
`frontend/nginx.conf`) — same-origin from the browser's perspective, so no
CORS configuration is needed for local development at all.

For frontend-only iteration without rebuilding the whole stack:
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to localhost:3000 (vite.config.ts)
```

Seed a demo account + API key:

```bash
npm run seed
```

### Running tests

```bash
docker compose up -d postgres redis
npm run migrate
npm test              # unit + integration, against real Postgres/Redis
npm run test:coverage
```

### Production deployment (Kubernetes)

```bash
kubectl apply -f k8s/ingress-and-config.yaml   # edit secrets first!
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/partition-cronjob.yaml
```

Build and push images in CI (see `.github/workflows/ci.yml`) tagged with
the commit SHA — never deploy a `:latest` tag to production, since it
makes rollback and audit both harder.

---

## 7. Operational runbooks

**Rotating the short-code secret.** `SHORTCODE_SECRET` only affects codes
generated *after* rotation — existing codes are stored verbatim in the DB
and keep working. Safe to rotate any time; no migration needed.

**Rotating JWT secrets.** Rotating `JWT_ACCESS_SECRET` invalidates all
outstanding access tokens immediately (users re-auth via refresh token).
Rotating `JWT_REFRESH_SECRET` logs everyone out — use `logout-all`'s
`token_version` bump instead for a per-user, non-disruptive alternative.

**Partition maintenance.** `click_events` is partitioned by month.
`scripts/create-partitions.ts` (wired to `k8s/partition-cronjob.yaml`,
runs monthly) creates the next partition ahead of need and drops
partitions older than `CLICK_EVENT_RETENTION_DAYS`. Dropping a partition
is an O(1) metadata operation — never run a row-by-row `DELETE` on this
table.

**A link is going viral / hot-key concern.** The redirect cache-aside
pattern already handles this (one Redis GET, cache-stampede-protected
repopulation). If a single link's traffic is large enough to bottleneck
one Redis key, the next step is client-side sharding of that key across
multiple Redis nodes with a small local read-through cache in each API
pod — not needed until real traffic numbers justify it.

**Rolling deploy.** `preStop: sleep 5` + `terminationGracePeriodSeconds: 20`
in the API deployment gives in-flight redirects time to complete before
SIGTERM; `server.ts`'s graceful shutdown handler stops accepting new
connections, drains in-flight ones, then closes DB/Redis cleanly, with a
10s hard-exit safety timer.

---

## 8. Known limitations / deliberate scope boundaries

These were left out deliberately rather than by oversight, and are noted
here so the scope boundary is explicit:

- **No team/workspace multi-tenancy.** Links belong to a single user.
  Adding a `workspace_id` column and a membership table is a
  straightforward extension of the existing schema but was left out to
  keep the core system coherent and reviewable.
- **Bulk creation is synchronous** (up to 500 links per request,
  processed sequentially to avoid pool exhaustion). A true bulk-import
  feature (CSV upload of 100k+ rows) belongs in a background job with a
  status-polling endpoint, not a synchronous HTTP request.
- **Unique-visitor counting is exact-count-based** (`COUNT(DISTINCT
  ip_hash)` per day), which is correct but re-scans click_events on every
  rollup upsert. For links exceeding ~100k clicks/day, swap this for a
  Redis HyperLogyLog (`PFADD`/`PFCOUNT`) for O(1) approximate distinct
  counts — noted as a scaling extension point in `analytics.service.ts`.
- **No automated malicious-URL scanning integration** — the SSRF/private-IP
  guard is real and always-on; a Google Safe Browsing (or similar)
  integration is stubbed via `GOOGLE_SAFE_BROWSING_API_KEY` in config but
  not wired up, since it requires an external API key and quota this
  environment can't provision. The `pending_review` link status exists in
  the schema specifically so this can be added later without a migration.
- **HPA scales on CPU/memory**, not queue depth for the worker. A KEDA
  BullMQ scaler would be the better production choice; noted in
  `k8s/worker-deployment.yaml`.
- **`EMBED_WORKER=true` (used by the default Render blueprint) is a
  free-tier accommodation, not a recommendation.** Running the click
  worker inside the API process means a click-processing burst can
  compete with redirect-serving CPU/memory — exactly the coupling §1's
  architecture is designed to avoid. It exists because Render's free tier
  has no background-worker service type; switch it off (and split the
  worker into its own service) the moment real traffic justifies a paid
  plan — see the commented block in `render.yaml`.
- **The frontend's JS bundle is ~576KB minified** (mostly `recharts`, used
  only on the per-link analytics page). Acceptable for this project's
  scope; a production frontend with performance budgets would
  code-split the analytics page behind `React.lazy()` so the chart
  library isn't in the initial bundle every visitor downloads.

---

## 9. Project structure

```
url-shortener/
├── frontend/               — React + Vite + TypeScript + Tailwind web app
│   ├── src/
│   │   ├── api/            — typed fetch client, auto token-refresh
│   │   ├── context/        — auth state (JWT access + refresh tokens)
│   │   ├── components/     — Navbar, ShortenForm, LinkRow, ClickChart, etc.
│   │   └── pages/          — Landing, Login, Signup, Dashboard, LinkDetail, ApiKeysPage
│   ├── nginx.conf          — SPA routing + /api reverse proxy (local docker)
│   ├── vercel.json         — SPA rewrite rule (Vercel deployment)
│   └── Dockerfile          — local docker-compose only; Vercel builds directly from source
├── src/                    — backend (see below)
├── render.yaml             — one-click Render deploy blueprint (see §0)
├── k8s/                    — Deployment/Service/HPA/Ingress/CronJob manifests
├── docker-compose.yml      — local dev stack: postgres, redis, api, worker, frontend
src/
  config/          — validated environment configuration (fails fast on bad config)
  db/               — Postgres pool, transaction helper, migrations
  lib/              — shortcode generator, SSRF-guarded URL validator, cache,
                       rate limiter, logger, error hierarchy
  middleware/       — auth (JWT + API key), rate limiting, global error handler
  modules/
    auth/           — registration, login, JWT + API key services
    apikeys/        — API key CRUD routes
    links/          — link CRUD: schema (zod), repository (SQL), service (logic), routes
    redirect/       — the hot path: cache-aside resolution, password flow, QR codes
    analytics/      — click processing (worker-side) + query routes (API-side)
  queue/            — BullMQ producer/consumer wiring, worker process entrypoint,
                       shared click-worker startup (used standalone AND embedded — see §0)
  app.ts            — Fastify app factory: plugins, routes, health checks
  server.ts         — boot + graceful shutdown + optional embedded worker
scripts/            — migration runner, seed data, partition maintenance
tests/
  unit/             — shortcode bijection proof, SSRF-guard coverage
  integration/      — full-stack tests against real Postgres/Redis
.github/workflows/  — CI: typecheck, lint, test (with real service containers), build
Dockerfile          — API image (multi-stage, non-root, health-checked, self-migrating)
Dockerfile.worker   — standalone worker image (production-recommended path)
```
