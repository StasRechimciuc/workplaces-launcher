import type { ResourceSpec } from '@workspace-launcher/shared';

/** A kind's own record of how to find one instance again — validated by that kind. */
export type ResourceHandle = Record<string, unknown>;

export type CaptureResult =
  /** `preexisting`: it was already there before the step ran — reused, not ours (decision 1). */
  { found: true; handle: ResourceHandle; preexisting: boolean } | { found: false; reason: string };

/**
 * - 'alive': still there, still the same target.
 * - 'gone': closed or exited — the ledger entry can be dropped.
 * - 'drifted': still there, but no longer this identity (decision 4)
 *   — no longer the workspace's; dropped without closing.
 * - 'unknown': couldn't tell (helper down, permission missing) — never
 *   treated as gone, so nothing is reopened or forgotten on a guess.
 */
export type HandleState =
  /** `handle`: an updated handle to record (e.g. a window bound lazily, on first sight). */
  | { state: 'alive'; handle?: ResourceHandle }
  | { state: 'gone' }
  | { state: 'drifted' }
  | { state: 'unknown'; reason: string };

export type CloseOutcome =
  | { outcome: 'closed' }
  | { outcome: 'already-gone' }
  /** It asked to stay open (unsaved work, a dialog) — left to the user, never forced. */
  /** Left open by design (e.g. stop-on-close is off) — it's let go of, nothing to retry. */
  | { outcome: 'kept-running'; detail: string }
  /**
   * It declined to close (unsaved changes, a dialog) — the user is
   * expected to deal with it and close again, so the workspace keeps its
   * claim and stays active.
   */
  | { outcome: 'refused'; detail: string }
  | { outcome: 'needs-permission'; detail: string }
  | { outcome: 'failed'; detail: string };

/**
 * How one kind of resource is found, followed and closed (WCs/
 * WC__window-tracking.md, "Per-resource mechanics"). Steps say WHAT
 * they open (ToolPlugin.resources); the kind owns HOW it's tracked, so
 * every step opening the same kind of thing — Spotify, Clockify, a
 * generic app — shares one implementation.
 *
 * Every method resolves rather than throws, reporting failures in its
 * result: a tracking problem must never take down a restore.
 */
export interface ResourceKindPlugin {
  readonly kind: string;
  /**
   * True when running a step again while its instance is live never
   * creates a second one (an app: `open -a` just activates it), so the
   * step still runs — re-opening a link or playlist is its point — and
   * only ownership is reused. False for window kinds, where running it
   * again would open a duplicate, so a step whose resources are all
   * live is skipped instead.
   */
  readonly openIsIdempotent: boolean;
  /**
   * True when closing it quits a whole app (the app kind) rather than
   * closing something inside one (a window) or outside any (a stack).
   * Such a close is held back while anything else in that app is still
   * owned, or an active workspace's untracked step uses the app by name.
   */
  readonly closesWholeApp: boolean;
  /** Before the step runs: whatever capture() needs to tell what's new. */
  snapshot(identity: ResourceSpec['identity'], options?: ResourceSpec['options']): Promise<unknown>;
  /**
   * After the step runs: the instance it opened (or found already
   * open). `options` (ResourceSpec.options) is the kind's to keep in
   * the handle if it needs them later, at close time.
   */
  capture(
    identity: ResourceSpec['identity'],
    snapshot: unknown,
    options?: ResourceSpec['options'],
  ): Promise<CaptureResult>;
  /** An instance that's running right now, whoever opened it; null if none. */
  findLive(identity: ResourceSpec['identity']): Promise<ResourceHandle | null>;
  check(handle: ResourceHandle, identity: ResourceSpec['identity']): Promise<HandleState>;
  close(handle: ResourceHandle): Promise<CloseOutcome>;
  /**
   * Non-idempotent kinds: puts a live instance whose work has finished
   * back to work in place, instead of the step opening a second one —
   * a terminal whose commands are done re-runs them in the same window
   * (decision 2). True if it did; false if there was nothing to revive.
   */
  revive?(handle: ResourceHandle): Promise<boolean>;
  /**
   * At startup, for an 'opening' record left by a crash or a restart
   * mid-open: the instance that record was opening, if one is running
   * and provably started after `since` (the record's creation time).
   * Optional — without it, such a record is simply dropped.
   */
  reconcileOpening?(identity: ResourceSpec['identity'], since: number): Promise<CaptureResult>;
}
