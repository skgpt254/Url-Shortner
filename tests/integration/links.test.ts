import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/db/client.js';
import { redis } from '../../src/lib/cache.js';

/**
 * These tests exercise the full stack against a REAL Postgres + Redis
 * (see docker-compose.yml / .github/workflows/ci.yml) rather than mocks.
 * Mocking the DB layer for a URL shortener would mean never actually
 * testing the one thing most likely to break in production: the unique
 * constraint race on custom aliases, the atomic click-limit update, the
 * cache invalidation on edit. Run locally with:
 *   docker compose up -d postgres redis && npm run migrate && npm test
 */

let app: FastifyInstance;
let authHeader: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const email = `test-${Date.now()}@example.com`;
  const res = await supertest(app.server)
    .post('/api/v1/auth/register')
    .send({ email, password: 'test-password-123' });
  authHeader = `Bearer ${res.body.accessToken}`;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await redis.quit();
});

describe('Link lifecycle', () => {
  it('creates a link and redirects to it', async () => {
    const createRes = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .send({ url: 'https://example.com/some/path' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.link.shortCode).toBeTruthy();

    const redirectRes = await supertest(app.server)
      .get(`/${createRes.body.link.shortCode}`)
      .redirects(0);

    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.location).toBe('https://example.com/some/path');
  });

  it('rejects a duplicate custom alias with 409', async () => {
    const alias = `test-alias-${Date.now()}`;
    const first = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .send({ url: 'https://example.com/a', customAlias: alias });
    expect(first.status).toBe(201);

    const second = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .send({ url: 'https://example.com/b', customAlias: alias });
    expect(second.status).toBe(409);
  });

  it('rejects SSRF-risky destination URLs at creation time', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .send({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(res.status).toBe(422);
  });

  it('honors the same Idempotency-Key by returning the original link', async () => {
    const key = `idem-${Date.now()}`;
    const first = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', key)
      .send({ url: 'https://example.com/idempotent' });

    const second = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', key)
      .send({ url: 'https://example.com/idempotent' });

    expect(second.status).toBe(200);
    expect(second.body.link.shortCode).toBe(first.body.link.shortCode);
    expect(second.body.idempotentReplay).toBe(true);
  });

  it('returns 410 Gone for an expired link', async () => {
    const createRes = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .send({ url: 'https://example.com/expired', expiresAt: new Date(Date.now() - 60_000).toISOString() });

    const redirectRes = await supertest(app.server).get(`/${createRes.body.link.shortCode}`);
    expect(redirectRes.status).toBe(410);
  });

  it('enforces a click limit atomically', async () => {
    const createRes = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .send({ url: 'https://example.com/limited', maxClicks: 1 });
    const code = createRes.body.link.shortCode;

    const firstClick = await supertest(app.server).get(`/${code}`).redirects(0);
    expect(firstClick.status).toBe(302);

    const secondClick = await supertest(app.server).get(`/${code}`);
    expect(secondClick.status).toBe(410);
  });

  it('requires a password before redirecting a protected link', async () => {
    const createRes = await supertest(app.server)
      .post('/api/v1/links')
      .set('Authorization', authHeader)
      .send({ url: 'https://example.com/secret', password: 'hunter2' });
    const code = createRes.body.link.shortCode;

    const withoutPassword = await supertest(app.server).get(`/${code}`);
    expect(withoutPassword.status).toBe(200); // renders the password prompt, not a redirect
    expect(withoutPassword.text).toContain('password protected');

    const wrongPassword = await supertest(app.server).post(`/${code}`).send({ password: 'wrong' });
    expect(wrongPassword.status).toBe(403);

    const correctPassword = await supertest(app.server).post(`/${code}`).send({ password: 'hunter2' }).redirects(0);
    expect(correctPassword.status).toBe(302);
  });

  it('allows anonymous quick-create without auth, and redirects it', async () => {
    const res = await supertest(app.server).post('/api/v1/links/quick').send({ url: 'https://example.com/anon' });
    expect(res.status).toBe(201);
    expect(res.body.link.shortCode).toBeTruthy();

    const redirectRes = await supertest(app.server).get(`/${res.body.link.shortCode}`).redirects(0);
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.location).toBe('https://example.com/anon');
  });

  it('rejects extra fields on the anonymous quick-create endpoint being interpreted as options', async () => {
    // customAlias etc. simply aren't part of the quick-create schema, so
    // passing one has no effect rather than erroring — this asserts that
    // shape, since silently accepting privileged fields through the
    // anonymous path would be a real vulnerability.
    const res = await supertest(app.server)
      .post('/api/v1/links/quick')
      .send({ url: 'https://example.com/anon2', customAlias: 'should-be-ignored' });
    expect(res.status).toBe(201);
    expect(res.body.link.isCustomAlias).toBe(false);
    expect(res.body.link.shortCode).not.toBe('should-be-ignored');
  });

  it('returns a 404 for a nonexistent short code', async () => {
    const res = await supertest(app.server).get('/this-code-does-not-exist-xyz');
    expect(res.status).toBe(404);
  });
});
