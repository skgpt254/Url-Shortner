import { describe, it, expect } from 'vitest';
import { validateDestinationUrl, UrlValidationError } from '../../src/lib/url-validator.js';

const opts = { ownDomains: new Set(['short.example.com']) };

describe('validateDestinationUrl', () => {
  it('accepts a normal https URL', async () => {
    const result = await validateDestinationUrl('https://example.com/some/path?x=1', opts);
    expect(result.hostname).toBe('example.com');
  });

  it('rejects disallowed schemes', async () => {
    await expect(validateDestinationUrl('ftp://example.com/file', opts)).rejects.toThrow(UrlValidationError);
    await expect(validateDestinationUrl('javascript:alert(1)', opts)).rejects.toThrow(UrlValidationError);
    await expect(validateDestinationUrl('file:///etc/passwd', opts)).rejects.toThrow(UrlValidationError);
  });

  it('rejects malformed URLs', async () => {
    await expect(validateDestinationUrl('not a url', opts)).rejects.toThrow(UrlValidationError);
  });

  it('rejects overly long URLs', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(3000);
    await expect(validateDestinationUrl(longUrl, opts)).rejects.toThrow(UrlValidationError);
  });

  it('rejects localhost and .local', async () => {
    await expect(validateDestinationUrl('http://localhost:8080/', opts)).rejects.toThrow(UrlValidationError);
    await expect(validateDestinationUrl('http://myserver.local/', opts)).rejects.toThrow(UrlValidationError);
  });

  it('rejects literal private/reserved IPv4 addresses', async () => {
    const badIps = [
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata endpoint
      'http://0.0.0.0/',
    ];
    for (const url of badIps) {
      await expect(validateDestinationUrl(url, opts)).rejects.toThrow(UrlValidationError);
    }
  });

  it('rejects literal private IPv6 addresses', async () => {
    await expect(validateDestinationUrl('http://[::1]/', opts)).rejects.toThrow(UrlValidationError);
    await expect(validateDestinationUrl('http://[fd00::1]/', opts)).rejects.toThrow(UrlValidationError);
  });

  it('accepts a public IPv4 literal', async () => {
    const result = await validateDestinationUrl('http://93.184.216.34/', opts);
    expect(result.hostname).toBe('93.184.216.34');
  });

  it('rejects self-referential URLs pointing back at the shortener', async () => {
    await expect(
      validateDestinationUrl('https://short.example.com/abc123', opts)
    ).rejects.toThrow(UrlValidationError);
  });
});
