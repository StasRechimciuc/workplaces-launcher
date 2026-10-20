// electron-store is pinned to ^8.x in package.json deliberately — v9+
// is pure ESM ("type": "module"), but this main process bundle builds
// as CommonJS, so `require('electron-store')` fails at runtime
// (ERR_REQUIRE_ESM) on anything newer. Don't bump this past 8.x
// without also changing the main process's build output to ESM.
import Store from 'electron-store';
import type { AppCandidate, ToolAppKey } from '@workspace-launcher/shared';
import { scanInstalledApps } from './app-detection';

interface AppDetectionCacheShape {
  scannedAtMs: number;
  candidatesByTool: Record<ToolAppKey, AppCandidate[]>;
}

/**
 * How long a cached scan is trusted before the orchestrator's own
 * ephemeral fallback (resolve-app-path.ts) forces a rescan. Apps don't
 * move every day — long enough that a restore never re-scans
 * `/Applications` on every single run, short enough that a cache from
 * last month isn't trusted indefinitely. Never consulted by the
 * renderer-facing detection handler, which always scans live instead
 * (see rescanAndCache's own doc comment) — only by the orchestrator's
 * unattended fallback for a step with no explicitly chosen appPath.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function emptyCandidates(): Record<ToolAppKey, AppCandidate[]> {
  return { vscode: [], chrome: [], spotify: [], clockify: [] };
}

const cacheStore = new Store<AppDetectionCacheShape>({
  name: 'app-detection-cache',
  defaults: { scannedAtMs: 0, candidatesByTool: emptyCandidates() },
});

function isFresh(): boolean {
  const scannedAtMs = cacheStore.get('scannedAtMs');
  return scannedAtMs > 0 && Date.now() - scannedAtMs < CACHE_TTL_MS;
}

/**
 * Always performs a live filesystem scan and overwrites the cache —
 * used by the renderer-triggered `app:detectInstalls` IPC handler,
 * where "is this app currently installed" must reflect reality right
 * now (e.g. the user just installed it a moment ago), never a
 * possibly-day-old cached answer.
 */
export async function rescanAndCache(): Promise<Record<ToolAppKey, AppCandidate[]>> {
  const result = await scanInstalledApps();
  // Two separate .set(key, value) calls, not one .set(object) — matches
  // this codebase's one existing electron-store precedent
  // (step-timing-history.ts's recordSuccessfulStepDuration).
  cacheStore.set('scannedAtMs', Date.now());
  cacheStore.set('candidatesByTool', result);
  return result;
}

/**
 * Cache-first: returns the cached scan if still fresh, else rescans
 * (and caches the fresh result) before returning. Used only by
 * resolve-app-path.ts's EPHEMERAL per-step fallback for a step with no
 * explicitly chosen `appPath` — never by anything that writes a
 * result back into a saved workspace config file.
 */
export async function getCandidatesForTool(tool: ToolAppKey): Promise<AppCandidate[]> {
  const all = isFresh() ? cacheStore.get('candidatesByTool') : await rescanAndCache();
  return all[tool];
}
