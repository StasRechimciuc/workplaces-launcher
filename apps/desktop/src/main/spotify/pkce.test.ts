import { describe, expect, it } from 'vitest';
import { generateCodeChallenge, generateCodeVerifier } from './pkce';

describe('generateCodeVerifier', () => {
  it('produces a string within RFC 7636s 43-128 character range', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('uses only unreserved/base64url characters, no padding', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('generates a different verifier on each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('generateCodeChallenge', () => {
  it('is deterministic for the same verifier', () => {
    const verifier = 'fixed-test-verifier-value-1234567890';
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
  });

  it('matches the known SHA-256/base64url digest of a fixture verifier', () => {
    // Computed independently via node:crypto for this exact string —
    // pins the implementation against a concrete expected value, not
    // just "it doesn't crash."
    const verifier = 'fixed-test-verifier-value-1234567890';
    const expected = 'C8Krd1ZYQT0oobnogFIX0qGoso7TnhHURa1erEYmB5w';
    expect(generateCodeChallenge(verifier)).toBe(expected);
  });
});
