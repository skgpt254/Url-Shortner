import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';

/**
 * Argon2id over bcrypt/scrypt: it's the PHC (Password Hashing Competition)
 * winner and specifically designed to resist both GPU-cracking (memory-hard)
 * and side-channel attacks (the "id" variant mixes data-dependent and
 * data-independent memory access). Default cost params below follow the
 * OWASP password storage cheat sheet baseline recommendation.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // argon2.verify throws on malformed hashes rather than returning false;
    // treat that the same as "doesn't match" rather than propagating a 500.
    return false;
  }
}

export interface AccessTokenPayload {
  sub: string; // user id
  role: 'user' | 'admin';
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
    issuer: 'shortlink-platform',
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, ver: tokenVersion }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
    issuer: 'shortlink-platform',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwt.accessSecret, { issuer: 'shortlink-platform' }) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string; ver: number } {
  return jwt.verify(token, config.jwt.refreshSecret, { issuer: 'shortlink-platform' }) as { sub: string; ver: number };
}
