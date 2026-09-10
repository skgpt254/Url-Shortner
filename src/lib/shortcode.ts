import { createHmac } from 'node:crypto';

/**
 * SHORT CODE GENERATION STRATEGY
 * ==============================
 *
 * The naive approach ("generate 7 random base62 chars, check DB for a
 * collision, retry if taken") has two problems at scale:
 *   1. It requires a DB round-trip *before* you know if the code is usable,
 *      and under high write concurrency the retry rate climbs as the
 *      keyspace fills up.
 *   2. It wastes entropy: random collisions are pure overhead.
 *
 * Instead we use a **counter + bijective permutation**:
 *
 *   1. A distributed, monotonically increasing integer ID is issued for
 *      every new link (Postgres `BIGINT GENERATED ALWAYS AS IDENTITY` — see
 *      the `links` table; Redis INCR is an alternative if you want to avoid
 *      a DB round trip for the ID itself, at the cost of an extra system to
 *      keep durable).
 *   2. That integer is run through a **Feistel network** — a construction
 *      from block-cipher design that turns any function "half-block ->
 *      half-block" into a full bijection (permutation) over a fixed bit
 *      width, with NO extra state and NO collisions, ever, by mathematical
 *      construction (it's a permutation of a finite set with itself).
 *   3. The permuted integer is encoded in Base62.
 *
 * Net effect: IDs 1, 2, 3, 4... map to short codes that look nothing like
 * "1, 2, 3, 4" (so competitors can't scrape your link volume or enumerate
 * other users' links by walking sequential codes), while remaining
 * *provably* collision-free without ever touching the database to check.
 *
 * IMPORTANT SECURITY NOTE: this is *obfuscation*, not an access-control
 * boundary. A short code must never be treated as a secret / capability
 * token on its own (see password-protected links for where we *do* need
 * a real secret). Public URLs are, definitionally, public.
 *
 * Custom aliases bypass this entirely and are stored/looked-up verbatim.
 */

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// 42 bits gives ~4.4 trillion addressable IDs — comfortably beyond any
// realistic single-shortener lifetime volume — while staying inside
// Number.MAX_SAFE_INTEGER so we don't need BigInt in the hot path.
// Must be even (Feistel splits into two equal halves).
const TOTAL_BITS = 42;
const HALF_BITS = TOTAL_BITS / 2; // 21
const HALF_MASK = (1 << HALF_BITS) - 1;
// HALF_MOD = 2^HALF_BITS. Used for combining/splitting the two halves via
// plain arithmetic (multiply/mod/divide) rather than JS's <<, >>>, | — those
// bitwise operators coerce operands to 32-bit SIGNED integers, which
// silently corrupts anything once the combined value exceeds 2^31 (our
// combined value is up to 2^42). Arithmetic on Numbers is safe and exact up
// to 2^53, so we stay well within range doing it this way. Bitwise XOR
// inside roundFunction is fine because it only ever operates on individual
// HALF_BITS-sized (21-bit) values, which fit safely inside 32 bits.
const HALF_MOD = 2 ** HALF_BITS;
const ROUNDS = 4; // 4 rounds gives good diffusion for a non-cryptographic obfuscation use case

// Fixed output width so all generated (non-custom) codes look uniform.
// ceil(42 bits / log2(62)) = 8 chars covers the full range with room to spare;
// we pad shorter encodings with the alphabet's zero-symbol on the left.
const OUTPUT_LENGTH = 7;

function roundFunction(secret: string, round: number, half: number): number {
  // HMAC-SHA256 truncated to HALF_BITS. This does not need to be
  // cryptographically secure (see note above) — HMAC is used here simply
  // because it's a convenient, well-distributed, keyed PRF that's already
  // in Node's stdlib (no extra dependency for what is a non-cryptographic
  // shuffle).
  const h = createHmac('sha256', secret).update(`${round}:${half}`).digest();
  // Take the first 4 bytes as a uint32, then mask down to HALF_BITS.
  const val = h.readUInt32BE(0);
  return val & HALF_MASK;
}

function feistelEncode(input: number, secret: string): number {
  let left = Math.floor(input / HALF_MOD);
  let right = input % HALF_MOD;
  for (let round = 0; round < ROUNDS; round++) {
    const newRight = (left ^ roundFunction(secret, round, right)) & HALF_MASK;
    left = right;
    right = newRight;
  }
  return left * HALF_MOD + right;
}

function feistelDecode(input: number, secret: string): number {
  let left = Math.floor(input / HALF_MOD);
  let right = input % HALF_MOD;
  for (let round = ROUNDS - 1; round >= 0; round--) {
    const newLeft = (right ^ roundFunction(secret, round, left)) & HALF_MASK;
    right = left;
    left = newLeft;
  }
  return left * HALF_MOD + right;
}

function toBase62(n: number): string {
  if (n === 0) return BASE62_ALPHABET[0]!;
  let out = '';
  let x = n;
  while (x > 0) {
    out = BASE62_ALPHABET[x % 62]! + out;
    x = Math.floor(x / 62);
  }
  return out;
}

function fromBase62(s: string): number {
  let n = 0;
  for (const ch of s) {
    const idx = BASE62_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base62 character: ${ch}`);
    n = n * 62 + idx;
  }
  return n;
}

/**
 * Generate a short code for a given monotonic integer ID.
 * Deterministic: the same (id, secret) pair always yields the same code,
 * so this needs no persistence of its own — the code is fully recoverable
 * from the ID and secret alone (see decodeShortCode).
 */
export function generateShortCode(id: number, secret: string): string {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error('id must be a non-negative integer');
  }
  if (id >= 2 ** TOTAL_BITS) {
    throw new Error(`id exceeds addressable range of ${2 ** TOTAL_BITS}`);
  }
  const permuted = feistelEncode(id, secret);
  const encoded = toBase62(permuted);
  return encoded.padStart(OUTPUT_LENGTH, BASE62_ALPHABET[0]!);
}

/**
 * Recover the original integer ID from a generated (non-custom) short code.
 * Useful for diagnostics; NOT used as an auth mechanism.
 */
export function decodeShortCode(code: string, secret: string): number {
  const permuted = fromBase62(code);
  return feistelDecode(permuted, secret);
}

/**
 * Validation rules for user-supplied custom aliases.
 * Kept separate from generated codes: custom aliases are free-form
 * (within reason) and stored/looked-up verbatim, no permutation involved.
 */
const RESERVED_ALIASES = new Set([
  'api', 'admin', 'static', 'assets', 'health', 'healthz', 'readyz',
  'login', 'logout', 'register', 'signup', 'signin', 'settings',
  'dashboard', 'docs', 'swagger', 'favicon.ico', 'robots.txt', 'sitemap.xml',
  'www', 'app', 'about', 'terms', 'privacy', 'help', 'support', 'null', 'undefined',
]);

const CUSTOM_ALIAS_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

export function validateCustomAlias(alias: string): { valid: true } | { valid: false; reason: string } {
  if (!CUSTOM_ALIAS_PATTERN.test(alias)) {
    return {
      valid: false,
      reason: 'Alias must be 3-32 characters, using only letters, numbers, hyphens and underscores.',
    };
  }
  if (RESERVED_ALIASES.has(alias.toLowerCase())) {
    return { valid: false, reason: `"${alias}" is a reserved word and cannot be used as an alias.` };
  }
  return { valid: true };
}
