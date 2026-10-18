import { shell } from 'electron';
import type { SpotifyConnectResult, SpotifyStatus } from '@workspace-launcher/shared';
import { generateCodeChallenge, generateCodeVerifier } from './pkce';
import { runLoopbackAuth } from './oauth-server';
import { clearCredentials, loadDisplayName, loadRefreshToken, saveCredentials } from './token-store';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = 'playlist-read-private playlist-read-collaborative';

/** Thrown by getValidAccessToken() when Spotify has revoked this app's
 * refresh token (the user disconnected the app from their Spotify
 * account settings, or it simply expired) — callers must prompt the
 * user to reconnect, not treat it as a generic/retryable failure. */
export class SpotifyReauthRequiredError extends Error {
  constructor() {
    super('Spotify access was revoked — reconnect your account.');
    this.name = 'SpotifyReauthRequiredError';
  }
}

interface AccessTokenCache {
  accessToken: string;
  expiresAt: number;
  /** The connected account's Spotify id — needed by playlists.ts to
   * flag ownedByCurrentUser without a second /me call per list. */
  accountId: string;
}

/** In-memory only, by design — access tokens are short-lived (~1hr) and
 * cheap to re-derive via the persisted refresh token, so persisting them
 * too would just be one more place a stale/leaked credential could sit. */
let accessTokenCache: AccessTokenCache | null = null;

function getClientId(): string {
  const clientId = process.env['SPOTIFY_CLIENT_ID'];
  if (!clientId) {
    throw new Error(
      'Spotify integration requires SPOTIFY_CLIENT_ID to be set (register a free app at ' +
        'developer.spotify.com/dashboard, with its redirect URI set to exactly ' +
        'http://127.0.0.1:61823/callback — a portless loopback URI is rejected by the ' +
        "dashboard's own form despite Spotify's docs describing it as valid).",
    );
  }
  return clientId;
}

async function exchangeToken(
  body: Record<string, string>,
): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && /invalid_grant/.test(text)) {
      clearCredentials();
      accessTokenCache = null;
      throw new SpotifyReauthRequiredError();
    }
    throw new Error(`Spotify token request failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }>;
}

async function fetchAccountId(accessToken: string): Promise<{ id: string; displayName: string }> {
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch the connected Spotify account (${response.status}).`);
  }
  const me = (await response.json()) as { id: string; display_name?: string };
  return { id: me.id, displayName: me.display_name ?? me.id };
}

/**
 * Runs the full Authorization Code + PKCE flow: opens the system browser
 * to Spotify's consent page, waits for the loopback redirect, exchanges
 * the code for tokens, and persists the refresh token. Never throws for
 * an expected failure (missing client id, user denial, network error) —
 * every path returns a `{success: false, error}` so the IPC handler and
 * the UI never have to special-case a thrown exception vs. a reported
 * failure.
 */
export async function connect(): Promise<SpotifyConnectResult> {
  // Set as soon as the loopback server starts — called in the catch
  // below on any failure reached after that point, so a failure (e.g.
  // shell.openExternal rejecting) doesn't leave the server listening
  // for the full AUTH_TIMEOUT_MS. A no-op once the exchange already
  // settled on its own (see oauth-server.ts's finish() guard).
  let cancelAuth: (() => void) | undefined;
  try {
    const clientId = getClientId();
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateCodeVerifier(); // same shape requirements as a verifier — just needs to be unguessable.

    const { port, result, cancel } = runLoopbackAuth(state);
    cancelAuth = cancel;
    const assignedPort = await port;
    const redirectUri = `http://127.0.0.1:${assignedPort}/callback`;

    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', SCOPES);

    await shell.openExternal(authorizeUrl.toString());

    const { code } = await result;

    const tokens = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (!tokens.refresh_token) {
      throw new Error('Spotify did not return a refresh token for this authorization.');
    }

    const { id: accountId, displayName } = await fetchAccountId(tokens.access_token);
    saveCredentials(tokens.refresh_token, displayName);
    accessTokenCache = {
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      accountId,
    };

    return { success: true, displayName };
  } catch (err) {
    cancelAuth?.();
    if (err instanceof SpotifyReauthRequiredError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Returns a currently-valid access token, refreshing via the persisted
 * refresh token if the in-memory one is missing or expired. Refresh
 * success is silent (the approved edge-case handling — this is not
 * user-visible); only a refresh *failure* propagates, and specifically
 * as SpotifyReauthRequiredError when Spotify has revoked access, so
 * callers can prompt a reconnect rather than show a generic error.
 */
export async function getValidAccessToken(): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.accessToken;
  }

  const refreshToken = loadRefreshToken();
  if (!refreshToken) {
    throw new SpotifyReauthRequiredError();
  }

  const clientId = getClientId();
  const tokens = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const { id: accountId } = await fetchAccountId(tokens.access_token);
  accessTokenCache = {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    accountId,
  };
  // Spotify may rotate the refresh token on refresh — persist the new
  // one when given, otherwise keep the existing one.
  if (tokens.refresh_token) {
    saveCredentials(tokens.refresh_token, loadDisplayName() ?? accountId);
  }

  return accessTokenCache.accessToken;
}

/** The connected account id cached alongside the access token — read by
 * playlists.ts to flag ownedByCurrentUser without its own /me call. */
export function getCachedAccountId(): string | null {
  return accessTokenCache?.accountId ?? null;
}

export function disconnect(): void {
  clearCredentials();
  accessTokenCache = null;
}

/** Cheap, no-network status check — reads the token store only, so
 * calling this on every modal open (unlike listPlaylists) costs nothing. */
export async function getConnectionStatus(): Promise<SpotifyStatus> {
  const displayName = loadDisplayName();
  const connected = loadRefreshToken() !== null;
  if (!connected) {
    return { connected: false };
  }
  return { connected: true, ...(displayName !== null ? { displayName } : {}) };
}
