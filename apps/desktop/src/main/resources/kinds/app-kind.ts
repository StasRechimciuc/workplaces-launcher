import { z } from 'zod';
import type { ResourceSpec } from '@workspace-launcher/shared';
import type { HelperResponse, WlHelperClient } from '../../platform/macos/wl-helper-client';
import { pollUntil } from '../../lib/poll-until';
import { readBundleId } from '../../platform/macos/bundle-id';
import type { CloseOutcome, HandleState, ResourceHandle, ResourceKindPlugin } from '../types';

/**
 * A whole app as a resource — Spotify, Clockify, a generic App step,
 * a link opened in a chosen app (WCs/WC__window-tracking.md, "Per
 * kind": Apps). No per-window identity: identity is the bundle id,
 * one running instance is one resource, and closing it is the app's
 * own native quit.
 *
 * An instance is identified by pid AND process start time, never pid
 * alone — the system reuses pids, and quitting whatever now has a
 * recorded pid could quit an unrelated app.
 */

export const APP_KIND = 'app';

const IdentitySchema = z.object({ bundleId: z.string().min(1) });

const HandleSchema = z.object({
  bundleId: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.number().nullable(),
});

type AppHandle = z.infer<typeof HandleSchema>;

export interface AppKindOptions {
  /** How long capture waits for the app to appear after its step ran. */
  captureTimeoutMs?: number;
  captureIntervalMs?: number;
  /** How long a quit waits for the app to exit (it may ask to save first). */
  quitWaitMs?: number;
}

type Instance = { pid: number; startedAt: number | null };

export function createAppKind(
  helper: Pick<WlHelperClient, 'request'>,
  options: AppKindOptions = {},
): ResourceKindPlugin {
  const captureTimeoutMs = options.captureTimeoutMs ?? 10_000;
  const captureIntervalMs = options.captureIntervalMs ?? 200;
  const quitWaitMs = options.quitWaitMs ?? 5_000;

  async function instances(
    bundleId: string,
  ): Promise<{ ok: true; apps: Instance[] } | { ok: false; reason: string }> {
    const response = await helper.request('isRunning', { bundleId });
    return response.ok
      ? { ok: true, apps: response.result.apps }
      : { ok: false, reason: response.error.message };
  }

  const toHandle = (bundleId: string, app: Instance): AppHandle => ({ bundleId, ...app });
  const sameInstance = (a: Instance, b: Instance): boolean =>
    a.pid === b.pid && a.startedAt === b.startedAt;

  return {
    kind: APP_KIND,
    openIsIdempotent: true,
    closesWholeApp: true,

    async snapshot(identity) {
      const bundleId = bundleIdOf(identity);
      if (!bundleId) return null;
      const running = await instances(bundleId);
      return running.ok ? running.apps : null;
    },

    async capture(identity, snapshot) {
      const bundleId = bundleIdOf(identity);
      if (!bundleId) return { found: false, reason: 'Not an app identity (no bundle id).' };
      const before = Array.isArray(snapshot) ? (snapshot as Instance[]) : null;
      let lastError = '';
      const { value } = await pollUntil(
        async () => {
          const running = await instances(bundleId);
          if (!running.ok) {
            lastError = running.reason;
            return undefined;
          }
          return running.apps.length > 0 ? running.apps : undefined;
        },
        { intervalMs: captureIntervalMs, timeoutMs: captureTimeoutMs },
      );
      if (!value) {
        return {
          found: false,
          reason:
            lastError || `${bundleId} wasn't running ${captureTimeoutMs / 1000}s after its step.`,
        };
      }
      // Prefer the instance that wasn't there before: that's the one
      // this step started. If every instance predates it, the step
      // reused an app the user already had open (decision 1).
      const fresh = before
        ? value.find((app) => !before.some((b) => sameInstance(app, b)))
        : undefined;
      const app = fresh ?? value[0]!;
      return {
        found: true,
        handle: toHandle(bundleId, app),
        // An unknown "before" (the snapshot failed) can't prove this
        // app opened it, so it's treated as not ours — never closed.
        preexisting: fresh === undefined,
      };
    },

    async reconcileOpening(identity, since) {
      const bundleId = bundleIdOf(identity);
      if (!bundleId) return { found: false, reason: 'Not an app identity (no bundle id).' };
      const running = await instances(bundleId);
      if (!running.ok) return { found: false, reason: running.reason };
      // Started after the record was written: the open it recorded is
      // what started it. Anything older was already running — not ours.
      const app = running.apps.find((a) => a.startedAt !== null && a.startedAt >= since);
      return app
        ? { found: true, handle: toHandle(bundleId, app), preexisting: false }
        : { found: false, reason: `No ${bundleId} instance started after the open was recorded.` };
    },

    async findLive(identity) {
      const bundleId = bundleIdOf(identity);
      if (!bundleId) return null;
      const running = await instances(bundleId);
      const app = running.ok ? running.apps[0] : undefined;
      return app ? toHandle(bundleId, app) : null;
    },

    async check(handle) {
      return checkHandle(handle);
    },

    async close(handle): Promise<CloseOutcome> {
      const state = await checkHandle(handle);
      if (state.state === 'gone') return { outcome: 'already-gone' };
      if (state.state === 'unknown') return { outcome: 'failed', detail: state.reason };
      // checkHandle only reports 'alive' for a handle that parsed.
      const { pid } = handle as AppHandle;
      const response = await helper.request('quitApp', { pid, waitMs: quitWaitMs });
      if (!response.ok) return failure(response);
      switch (response.result.outcome) {
        case 'quit':
          return { outcome: 'closed' };
        case 'not-running':
          return { outcome: 'already-gone' };
        case 'still-running':
          return {
            outcome: 'refused',
            detail: 'it asked to stay open — it may have unsaved changes',
          };
      }
    },
  };

  async function checkHandle(handle: ResourceHandle): Promise<HandleState> {
    const parsed = HandleSchema.safeParse(handle);
    if (!parsed.success) return { state: 'gone' };
    const running = await instances(parsed.data.bundleId);
    if (!running.ok) return { state: 'unknown', reason: running.reason };
    return running.apps.some((app) => sameInstance(app, parsed.data))
      ? { state: 'alive' }
      : { state: 'gone' };
  }
}

function bundleIdOf(identity: ResourceSpec['identity']): string | null {
  const parsed = IdentitySchema.safeParse(identity);
  return parsed.success ? parsed.data.bundleId : null;
}

function failure(response: Extract<HelperResponse<unknown>, { ok: false }>): CloseOutcome {
  return response.error.code === 'not-trusted'
    ? { outcome: 'needs-permission', detail: response.error.message }
    : { outcome: 'failed', detail: response.error.message };
}

/**
 * The app resource for a step that opens `target` — an app bundle
 * path, or (for older configs with no saved path) a bare app name,
 * which has no readable bundle and so isn't tracked: that step keeps
 * the app-level behavior, and the reason is logged.
 */
export async function appResourceFor(target: string, label: string): Promise<ResourceSpec[]> {
  if (!target.endsWith('.app')) {
    console.error(`Not tracking "${label}": no app bundle path saved for it (${target}).`);
    return [];
  }
  const bundleId = await readBundleId(target);
  return bundleId ? [{ kind: APP_KIND, identity: { bundleId }, label, appName: label }] : [];
}
