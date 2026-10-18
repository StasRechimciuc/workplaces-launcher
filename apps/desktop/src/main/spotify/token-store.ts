// electron-store pinned to ^8.x — see orchestrator/step-timing-history.ts's
// identical doc comment: v9+ is pure ESM, this main process bundles as
// CommonJS, require('electron-store') would throw ERR_REQUIRE_ESM on 9+.
import Store from 'electron-store';
import { safeStorage } from 'electron';

interface SpotifyTokenStoreShape {
  /** base64 of safeStorage.encryptString()'s output. null = never connected / disconnected. */
  encryptedRefreshToken: string | null;
  /** Not sensitive — stored in plaintext alongside the encrypted token
   * so spotify:status (auth.ts's getConnectionStatus) can report the
   * connected account's name without a network round trip. */
  displayName: string | null;
}

const tokenStore = new Store<SpotifyTokenStoreShape>({
  name: 'spotify-tokens',
  defaults: { encryptedRefreshToken: null, displayName: null },
});

/**
 * Encrypts and persists the refresh token + display name from a
 * successful connect. Electron's safeStorage API on this app's pinned
 * Electron version (^33.2.1) is synchronous (encryptString/
 * decryptString) — there is no *Async variant to await here.
 */
export function saveCredentials(refreshToken: string, displayName: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Cannot store Spotify credentials: OS secure storage is unavailable.');
  }
  const encrypted = safeStorage.encryptString(refreshToken);
  tokenStore.set('encryptedRefreshToken', encrypted.toString('base64'));
  tokenStore.set('displayName', displayName);
}

export function loadRefreshToken(): string | null {
  const stored = tokenStore.get('encryptedRefreshToken');
  if (stored === null) {
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Cannot read stored Spotify credentials: OS secure storage is unavailable.');
  }
  return safeStorage.decryptString(Buffer.from(stored, 'base64'));
}

export function loadDisplayName(): string | null {
  return tokenStore.get('displayName');
}

export function clearCredentials(): void {
  tokenStore.set('encryptedRefreshToken', null);
  tokenStore.set('displayName', null);
}
