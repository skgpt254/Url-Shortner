import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../modules/auth/auth.service.js';
import { verifyApiKey } from '../modules/auth/apikey.service.js';
import { UnauthorizedError } from '../lib/errors.js';

export interface AuthContext {
  userId: string;
  role: 'user' | 'admin';
  /** How the request authenticated — affects rate-limit tier and audit logging. */
  method: 'jwt' | 'api_key';
  apiKeyScopes?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Accepts either:
 *   Authorization: Bearer <JWT access token>   (dashboard / browser sessions)
 *   Authorization: Bearer sl_live_...          (programmatic API keys)
 * and populates request.auth. Throws UnauthorizedError if neither is valid.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header.');
  }
  const token = header.slice('Bearer '.length).trim();

  if (token.startsWith('sl_')) {
    const record = await verifyApiKey(token);
    if (!record) throw new UnauthorizedError('Invalid or revoked API key.');
    request.auth = { userId: record.user_id, role: 'user', method: 'api_key', apiKeyScopes: record.scopes };
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    request.auth = { userId: payload.sub, role: payload.role, method: 'jwt' };
  } catch {
    throw new UnauthorizedError('Invalid or expired access token.');
  }
}

/** Like requireAuth but does not throw if no credentials are present — used on the redirect path where auth is optional. */
export async function optionalAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.headers.authorization) return;
  await requireAuth(request, reply);
}

export function requireScope(scope: string) {
  return async (request: FastifyRequest): Promise<void> => {
    if (request.auth?.method !== 'api_key') return; // JWT sessions implicitly have full scope for their own account
    if (!request.auth.apiKeyScopes?.includes(scope)) {
      throw new UnauthorizedError(`API key is missing required scope: ${scope}`);
    }
  };
}
