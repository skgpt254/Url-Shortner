import { describe, it, expect } from 'vitest';
import { generateShortCode, decodeShortCode, validateCustomAlias } from '../../src/lib/shortcode.js';

const SECRET = 'test-secret-that-is-at-least-32-bytes-long!!';

describe('generateShortCode', () => {
  it('is deterministic for the same id + secret', () => {
    const a = generateShortCode(12345, SECRET);
    const b = generateShortCode(12345, SECRET);
    expect(a).toBe(b);
  });

  it('produces no collisions across a large contiguous range of ids', () => {
    const seen = new Set<string>();
    const N = 50_000;
    for (let i = 0; i < N; i++) {
      const code = generateShortCode(i, SECRET);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(N);
  });

  it('does not produce visibly-sequential codes for sequential ids', () => {
    const codes = Array.from({ length: 5 }, (_, i) => generateShortCode(i, SECRET));
    // Sanity check: consecutive ids should not share a long common prefix,
    // which would leak sequence information.
    for (let i = 1; i < codes.length; i++) {
      const a = codes[i - 1]!;
      const b = codes[i]!;
      let sharedPrefix = 0;
      while (sharedPrefix < a.length && a[sharedPrefix] === b[sharedPrefix]) sharedPrefix++;
      expect(sharedPrefix).toBeLessThan(a.length - 1);
    }
  });

  it('round-trips through decodeShortCode', () => {
    for (const id of [0, 1, 42, 999999, 123456789]) {
      const code = generateShortCode(id, SECRET);
      expect(decodeShortCode(code, SECRET)).toBe(id);
    }
  });

  it('different secrets produce different codes for the same id', () => {
    const a = generateShortCode(777, SECRET);
    const b = generateShortCode(777, 'a-completely-different-secret-value-32b');
    expect(a).not.toBe(b);
  });

  it('rejects ids outside the addressable range', () => {
    expect(() => generateShortCode(-1, SECRET)).toThrow();
    expect(() => generateShortCode(2 ** 42, SECRET)).toThrow();
  });
});

describe('validateCustomAlias', () => {
  it('accepts well-formed aliases', () => {
    expect(validateCustomAlias('my-cool_link1').valid).toBe(true);
  });

  it('rejects aliases that are too short', () => {
    expect(validateCustomAlias('ab').valid).toBe(false);
  });

  it('rejects aliases with invalid characters', () => {
    expect(validateCustomAlias('has a space').valid).toBe(false);
    expect(validateCustomAlias('has/slash').valid).toBe(false);
  });

  it('rejects reserved words case-insensitively', () => {
    expect(validateCustomAlias('admin').valid).toBe(false);
    expect(validateCustomAlias('Admin').valid).toBe(false);
    expect(validateCustomAlias('API').valid).toBe(false);
  });
});
