import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as usersRepo from './users.repository.js';
import { hashPassword, verifyPassword, signAccessToken, signRefreshToken, verifyRefreshToken } from './auth.service.js';
import { ConflictError, UnauthorizedError } from '../../lib/errors.js';
import { rateLimitMiddleware } from '../../middleware/rate-limit.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', { preHandler: rateLimitMiddleware('auth-register', 5) }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const existing = await usersRepo.findUserByEmail(input.email);
    if (existing) {
      throw new ConflictError('An account with this email already exists.');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await usersRepo.createUser(input.email, passwordHash, input.displayName ?? null);

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = signRefreshToken(user.id, user.token_version);
    reply.status(201);
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, displayName: user.display_name } };
  });

  app.post('/auth/login', { preHandler: rateLimitMiddleware('auth-login', 10) }, async (request) => {
    const input = loginSchema.parse(request.body);
    const user = await usersRepo.findUserByEmail(input.email);

    // Constant-shape response regardless of whether the email exists, to
    // avoid a user-enumeration side channel via response-time or content
    // differences. We still run a dummy hash-verify against a fixed hash
    // when the user doesn't exist, so response timing doesn't leak it either.
    const passwordHash = user?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const passwordOk = await verifyPassword(passwordHash, input.password);

    if (!user || !user.is_active || !passwordOk) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = signRefreshToken(user.id, user.token_version);
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, displayName: user.display_name } };
  });

  app.post('/auth/refresh', { preHandler: rateLimitMiddleware('auth-refresh', 30) }, async (request) => {
    const { refreshToken } = refreshSchema.parse(request.body);

    let payload: { sub: string; ver: number };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }

    const user = await usersRepo.findUserById(payload.sub);
    if (!user || !user.is_active || user.token_version !== payload.ver) {
      // token_version mismatch means the user logged out everywhere or
      // changed their password since this refresh token was issued.
      throw new UnauthorizedError('Refresh token has been revoked.');
    }

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    return { accessToken };
  });

  app.post('/auth/logout-all', { preHandler: requireAuth }, async (request, reply) => {
    await usersRepo.bumpTokenVersion(request.auth!.userId);
    reply.status(204);
  });
}
