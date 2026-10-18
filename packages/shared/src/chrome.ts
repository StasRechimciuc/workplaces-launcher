/**
 * Type-only, like spotify.ts — safe to re-export from this package's
 * main barrel for every consumer, including preload (no runtime value,
 * nothing for a sandboxed preload's require() to fail resolving).
 */
export interface ChromeProfileInfo {
  folder: string;
  name: string;
}

export type ChromeListProfilesResult =
  | { success: true; profiles: ChromeProfileInfo[] }
  | { success: false; error: string };
