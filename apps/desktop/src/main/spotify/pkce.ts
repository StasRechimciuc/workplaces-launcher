import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636) verifier/challenge pair for the Authorization Code +
 * PKCE flow — spotify/auth.ts's connect() generates one fresh pair per
 * connect attempt. No client secret is needed or stored anywhere: PKCE
 * is specifically the mechanism that lets a public/native client (this
 * desktop app) authorize safely without one.
 */

/**
 * 64 random bytes -> ~86 base64url characters (no padding), within
 * RFC 7636's required 43-128 character range and using only its
 * allowed unreserved character set (base64url's alphabet is a subset
 * of it).
 */
export function generateCodeVerifier(): string {
  return randomBytes(64).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
