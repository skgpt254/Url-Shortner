import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF PROTECTION
 * ===============
 * A URL shortener that ever *fetches* a destination URL server-side (link
 * previews, safe-browsing checks, favicon scraping, OpenGraph unfurling...)
 * is a textbook SSRF vector: an attacker shortens
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/role`
 * (cloud metadata endpoint) or `http://10.0.0.5:6379/` (internal Redis) and
 * waits for your server to fetch it on their behalf.
 *
 * Even though the *redirect* itself (302 Location header) is client-side —
 * the visitor's browser follows it, not our server — we still validate at
 * creation time because:
 *   1. Any future feature that DOES fetch server-side (preview pages, safe
 *      browsing re-checks, screenshot generation) inherits this guard for
 *      free if URLs are validated at the boundary.
 *   2. It's good hygiene to reject obviously-malicious targets up front
 *      rather than relying on every downstream consumer to re-check.
 *
 * The check re-resolves DNS at validation time (not just parses the
 * hostname) because "safe-looking" hostnames can resolve to internal IPs
 * (DNS rebinding). We do NOT re-check DNS again at redirect time — that
 * would reintroduce a TOCTOU-style rebinding window for an operation
 * (redirecting the *client's* browser) that doesn't need it, since the
 * client's own browser/OS resolves the destination, not our server.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;

export class UrlValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

/** Returns true if the given IPv4 address (as 4 octets) falls in a private/reserved/loopback/link-local range. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // fail closed
  const [a, b] = parts as [number, number, number, number];

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0+ multicast/reserved/broadcast

  return false;
}

/** Returns true if the given IPv6 address falls in a private/reserved/loopback/link-local range. */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized === '::') return true; // unspecified
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 address — unwrap and check as IPv4.
    const v4 = normalized.slice('::ffff:'.length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

function isPrivateOrReservedIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // unparseable -> fail closed
}

export interface UrlValidationOptions {
  /** Hostnames that belong to this shortener itself — reject to prevent redirect loops / chained shortening. */
  ownDomains: Set<string>;
}

/**
 * Validates a user-supplied destination URL. Throws UrlValidationError with
 * a machine-readable `code` on failure; callers map codes to HTTP responses.
 */
export async function validateDestinationUrl(
  rawUrl: string,
  options: UrlValidationOptions
): Promise<{ normalized: string; hostname: string }> {
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
    throw new UrlValidationError(`URL must be between 1 and ${MAX_URL_LENGTH} characters.`, 'INVALID_LENGTH');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlValidationError('URL is not well-formed.', 'MALFORMED_URL');
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new UrlValidationError(
      `URL scheme "${parsed.protocol}" is not allowed. Only http and https are permitted.`,
      'DISALLOWED_SCHEME'
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UrlValidationError('Localhost and .local addresses are not allowed.', 'LOCALHOST_BLOCKED');
  }

  if (options.ownDomains.has(hostname)) {
    throw new UrlValidationError(
      'Cannot shorten a URL that already points at this shortener (redirect loop).',
      'SELF_REFERENTIAL'
    );
  }

  // If the hostname is a literal IP, check it directly.
  if (isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      throw new UrlValidationError('URL resolves to a private or reserved IP address.', 'PRIVATE_IP_BLOCKED');
    }
  } else {
    // Resolve DNS and check ALL returned addresses (a hostname can have
    // multiple A/AAAA records — an attacker only needs one of them to be
    // internal for a DNS-rebinding-style attack against anything that
    // fetches this URL later).
    let addresses: { address: string }[];
    try {
      addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new UrlValidationError('Could not resolve destination hostname.', 'DNS_RESOLUTION_FAILED');
    }
    if (addresses.length === 0) {
      throw new UrlValidationError('Destination hostname did not resolve to any address.', 'DNS_RESOLUTION_FAILED');
    }
    for (const { address } of addresses) {
      if (isPrivateOrReservedIP(address)) {
        throw new UrlValidationError(
          'URL hostname resolves to a private or reserved IP address.',
          'PRIVATE_IP_BLOCKED'
        );
      }
    }
  }

  return { normalized: parsed.toString(), hostname };
}
