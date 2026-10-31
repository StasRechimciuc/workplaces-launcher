import type {
  LeftOpenEntry,
  ResourceContext,
  ResourceSpec,
  StepResult,
  WorkspaceConfig,
  WorkspaceStep,
} from '@workspace-launcher/shared';
import { getTool } from '../tools/registry';
import { KeyedLock } from '../lib/keyed-lock';
import { getResourceKind, identityKeyFor } from './kind-registry';
import {
  addOwner,
  addResource,
  findByIdentity,
  findResource,
  isWorkspaceActive,
  releaseWorkspace,
  removeOwner,
  removeResource,
  resourcesOwnedBy,
  updateResource,
  type Resource,
  type ResourceOwner,
} from './ledger';
import type { ResourceLedgerStore } from './ledger-store';
import { getLedgerStore } from './runtime';
import type { ResourceHandle, ResourceKindPlugin } from './types';

/**
 * Restore / Close / Switch / Retry for TRACKED steps, over the
 * resource ledger (WCs/WC__window-tracking.md, "Phase 2, slice 4
 * technical plan"). The orchestrator decides which steps are tracked
 * (resolveTrackedSteps) and runs everything else the app-level way.
 *
 * Locking: one key per workspace (`ws:<id>`, taken by the
 * orchestrator around a whole operation) and one per resource identity
 * (`res:<kind>:<key>`, taken here around each lookup → open → record
 * and each close). Identity keys are always taken after the workspace
 * key and never the other way round, so there's no lock-order cycle.
 */
export const locks = new KeyedLock();

export function workspaceLockKey(workspaceId: string): string {
  return `ws:${workspaceId}`;
}

function identityLockKey(kind: string, identityKey: string): string {
  return `res:${kind}:${identityKey}`;
}

/** A tracked step: its resources resolved to registered kinds. */
export interface TrackedStep {
  step: WorkspaceStep;
  specs: ResourceSpec[];
}

/**
 * Splits a workspace's steps into tracked ones (every spec resolved
 * and its kind registered) and untracked ones. With tracking off
 * (no ledger), everything is untracked.
 */
export async function resolveTrackedSteps(
  config: WorkspaceConfig,
): Promise<{ tracked: TrackedStep[]; untracked: WorkspaceStep[] }> {
  const tracked: TrackedStep[] = [];
  const untracked: WorkspaceStep[] = [];
  for (const step of config.steps) {
    const specs = getLedgerStore()
      ? await specsFor(step, { workspaceName: config.name, stepId: step.id })
      : [];
    if (specs.length > 0 && specs.every((s) => getResourceKind(s.kind))) {
      tracked.push({ step, specs });
    } else {
      untracked.push(step);
    }
  }
  return { tracked, untracked };
}

async function specsFor(step: WorkspaceStep, context: ResourceContext): Promise<ResourceSpec[]> {
  const tool = getTool(step.type);
  if (!tool?.resources) return [];
  const validation = tool.validate(step.params);
  if (!validation.valid) return [];
  try {
    return await tool.resources(validation.data, context);
  } catch (err) {
    console.error(
      `Couldn't work out what "${step.type}" opens — running it untracked: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

const REUSED_RESULT: Omit<StepResult, 'durationMs'> = {
  success: true,
  message: 'Already open — reused.',
  reused: true,
};

/**
 * Restore for one tracked step:
 * 1. A spec with a live ledger resource gains this owner (reuse).
 * 2. Every other spec gets a write-ahead 'opening' record and a
 *    snapshot before anything runs.
 * 3. The step runs — unless everything is already live and opening it
 *    again would duplicate something (a non-idempotent kind).
 * 4. Each opening spec is captured whatever the step's outcome: a
 *    failed or timed-out step may still have opened something, and
 *    Retry needs exactly that recorded.
 */
export async function openTrackedStep(
  store: ResourceLedgerStore,
  workspaceId: string,
  { step, specs }: TrackedStep,
  run: (liveResourceKeys: ReadonlySet<string>) => Promise<StepResult>,
): Promise<StepResult> {
  const owner: ResourceOwner = { workspaceId, stepId: step.id };
  const keys = specs.map((s) => identityLockKey(s.kind, identityKeyFor(s)));

  return locks.withLocks(keys, async () => {
    const pending: {
      spec: ResourceSpec;
      kind: ResourceKindPlugin;
      id: string;
      snapshot: unknown;
    }[] = [];
    let mustRun = false;
    const liveKeys = new Set<string>();
    let revived = 0;

    for (const spec of specs) {
      const kind = getResourceKind(spec.kind)!;
      const live = await findLiveResource(store, kind, spec);
      if (live) {
        store.update((l) => addOwner(l, live.id, owner));
        if (kind.openIsIdempotent) {
          mustRun = true;
        } else {
          liveKeys.add(live.identityKey);
          if (kind.revive && live.handle && (await kind.revive(live.handle))) revived++;
        }
        continue;
      }
      const snapshot = await kind.snapshot(spec.identity, spec.options);
      let opening!: Resource;
      store.update((l) => {
        const added = addResource(l, {
          kind: spec.kind,
          identityKey: identityKeyFor(spec),
          label: spec.label,
          ...(spec.appName === undefined ? {} : { appName: spec.appName }),
          owner,
          createdByApp: true,
          handle: null,
          state: 'opening',
        });
        opening = added.resource;
        return added.ledger;
      });
      pending.push({ spec, kind, id: opening.id, snapshot });
      mustRun = true;
    }

    // Re-running finished commands in place is doing something — not
    // "reused" for the header. Re-running a step whose every resource
    // was already open (an app: it just comes forward, a playlist
    // restarts) opened nothing new — that still counts as reused.
    const ran = mustRun ? await run(liveKeys) : null;
    const result: StepResult =
      ran !== null
        ? ran.success && pending.length === 0 && revived === 0
          ? { ...ran, reused: true }
          : ran
        : revived > 0
          ? { success: true, message: 'Already open — re-ran its commands there.', durationMs: 0 }
          : { ...REUSED_RESULT, durationMs: 0 };

    const notTracked: string[] = [];
    for (const { spec, kind, id, snapshot } of pending) {
      const captured = await kind.capture(spec.identity, snapshot, spec.options);
      if (captured.found) {
        store.update((l) =>
          updateResource(l, id, {
            state: 'open',
            handle: captured.handle,
            createdByApp: !captured.preexisting,
          }),
        );
      } else {
        console.error(`Not tracking ${spec.label} for this step: ${captured.reason}`);
        store.update((l) => removeResource(l, id));
        // Said on the step itself, not only logged: what it opened won't
        // be closed (or saved) with the workspace.
        notTracked.push(`${spec.label}: ${captured.reason}`);
      }
    }
    return notTracked.length === 0
      ? result
      : {
          ...result,
          message: `${result.message} Not tracked, so Close won't close it — ${notTracked.join('; ')}.`,
        };
  });
}

/**
 * The ledger's live resource for this identity, if any. Entries that
 * are provably gone, drifted, handle-less (dropped by the boot guard)
 * or stuck 'opening' are removed on the way. A check that can't tell
 * ('unknown') keeps the entry: better to reuse a possibly-dead
 * resource than open a duplicate of a live one.
 */
async function findLiveResource(
  store: ResourceLedgerStore,
  kind: ResourceKindPlugin,
  spec: ResourceSpec,
): Promise<Resource | undefined> {
  for (const resource of findByIdentity(store.get(), spec.kind, identityKeyFor(spec))) {
    if (resource.state === 'opening' || resource.handle === null) {
      store.update((l) => removeResource(l, resource.id));
      continue;
    }
    const state = await kind.check(resource.handle, spec.identity);
    if (state.state === 'alive' || state.state === 'unknown') {
      if (state.state === 'alive' && state.handle) recordHandle(store, resource.id, state.handle);
      return resource;
    }
    store.update((l) => removeResource(l, resource.id));
  }
  return undefined;
}

/** Saves a handle a check refined (e.g. a window bound on first sight). */
function recordHandle(
  store: ResourceLedgerStore,
  resourceId: string,
  handle: ResourceHandle,
): void {
  store.update((l) =>
    findResource(l, resourceId) ? updateResource(l, resourceId, { handle }) : l,
  );
}

export interface CloseReport {
  closed: string[];
  leftOpen: LeftOpenEntry[];
  /** Something this app should have closed is still open (failed / needs permission / refused). */
  hadFailure: boolean;
  /** Resources that declined to close — their releasing owners get their claims back. */
  refused: string[];
}

export interface CloseContext {
  /** App names an active workspace's untracked steps still use (see tool-identity.ts). */
  untrackedAppNamesInUse: ReadonlySet<string>;
  /** Identities another operation is about to reuse — left open (Switch's transfer). */
  keepIdentityKeys?: ReadonlySet<string>;
  /**
   * Report what stays open because another workspace still claims it
   * (`still-used`, with those workspaces' ids in `usedBy`), so Close
   * never leaves an app running without saying why. Off for Switch,
   * where the only remaining claimant is the target itself.
   */
  reportStillClaimed?: boolean;
}

/**
 * Releases a workspace's claims — all of them, or only those of
 * `stepIds` — and closes whatever that leaves ownerless.
 */
export async function releaseAndClose(
  store: ResourceLedgerStore,
  workspaceId: string,
  context: CloseContext,
  stepIds?: ReadonlySet<string>,
): Promise<CloseReport> {
  const released = (o: ResourceOwner): boolean =>
    o.workspaceId === workspaceId && (stepIds === undefined || stepIds.has(o.stepId));
  const releasedOwners = new Map(
    resourcesOwnedBy(store.get(), workspaceId)
      .filter((r) => r.owners.some(released))
      .map((r) => [r.id, r.owners.filter(released)] as const),
  );
  const affected = [...releasedOwners.keys()];
  store.update((l) => releaseWorkspace(l, workspaceId, stepIds));
  const report = await closeOwnerless(store, affected, context);
  restoreClaims(store, report.refused, releasedOwners);
  if (context.reportStillClaimed) {
    for (const id of affected) {
      const resource = findResource(store.get(), id);
      if (!resource || resource.owners.length === 0 || report.refused.includes(id)) continue;
      report.leftOpen.push({
        appName: resource.label,
        reason: 'still-used',
        usedBy: [...new Set(resource.owners.map((o) => o.workspaceId))],
      });
    }
  }
  return report;
}

/** A refused close gives the claims released for it back — the workspace stays active. */
function restoreClaims(
  store: ResourceLedgerStore,
  refused: readonly string[],
  releasedOwners: ReadonlyMap<string, readonly ResourceOwner[]>,
): void {
  for (const id of refused) {
    for (const owner of releasedOwners.get(id) ?? []) {
      store.update((l) => (findResource(l, id) ? addOwner(l, id, owner) : l));
    }
  }
}

/**
 * Closes each resource that ended up with no owners, under its
 * identity lock (re-read inside it — a concurrent Restore may have
 * claimed it meanwhile). Only resources this app opened are ever
 * closed (decision 1); one an untracked step still uses by app name is
 * left alone. Closed, gone and handed-over entries leave the ledger;
 * a failed or permission-blocked close keeps its (ownerless) entry,
 * so the instance is still recognized as ours if it's reused.
 */
export async function closeOwnerless(
  store: ResourceLedgerStore,
  resourceIds: readonly string[],
  context: CloseContext,
): Promise<CloseReport> {
  const report: CloseReport = { closed: [], leftOpen: [], hadFailure: false, refused: [] };
  // Whole-app quits go last, so a window inside the app that refuses
  // to close (unsaved changes) is known before its app would be quit.
  const closesWholeApp = (id: string): boolean => {
    const resource = findResource(store.get(), id);
    return resource !== undefined && getResourceKind(resource.kind)?.closesWholeApp === true;
  };
  const ordered = [
    ...resourceIds.filter((id) => !closesWholeApp(id)),
    ...resourceIds.filter(closesWholeApp),
  ];
  for (const id of ordered) {
    const snapshot = findResource(store.get(), id);
    if (!snapshot) continue;
    await locks.withLocks([identityLockKey(snapshot.kind, snapshot.identityKey)], async () => {
      const resource = findResource(store.get(), id);
      if (!resource || resource.owners.length > 0) return;
      if (context.keepIdentityKeys?.has(resource.identityKey)) return;
      const drop = (): void => {
        store.update((l) => removeResource(l, id));
      };

      if (!resource.createdByApp) {
        report.leftOpen.push({ appName: resource.label, reason: 'not-ours' });
        drop();
        return;
      }
      const kind = getResourceKind(resource.kind);
      // Quitting a whole app also takes down everything else inside it:
      // held back while an untracked step elsewhere uses the app, or
      // another owned resource (a VS Code window) lives in it.
      if (kind?.closesWholeApp && resource.appName !== undefined) {
        const appName = resource.appName;
        // Still in use: owned, kept for the workspace being switched
        // to, or refused to close just now (its claim is restored after
        // this batch).
        const usedInside = store
          .get()
          .resources.some(
            (r) =>
              r.id !== id &&
              r.appName === appName &&
              (r.owners.length > 0 ||
                context.keepIdentityKeys?.has(r.identityKey) === true ||
                report.refused.includes(r.id)),
          );
        if (context.untrackedAppNamesInUse.has(appName) || usedInside) {
          report.leftOpen.push({ appName: resource.label, reason: 'still-used' });
          drop();
          return;
        }
      }
      if (!kind || resource.handle === null) {
        // Nothing left to identify it by (reboot, or a kind this build
        // doesn't have) — it can't be closed, and it's no one's now.
        drop();
        return;
      }
      const outcome = await kind.close(resource.handle);
      switch (outcome.outcome) {
        case 'closed':
          report.closed.push(resource.label);
          drop();
          return;
        case 'already-gone':
          drop();
          return;
        case 'kept-running':
          report.leftOpen.push({
            appName: resource.label,
            reason: 'kept-running',
            detail: outcome.detail,
          });
          drop();
          return;
        case 'refused':
          // Kept, and claimed again by whoever released it (the caller
          // restores that) — so Close stays available once the user has
          // dealt with it.
          report.leftOpen.push({
            appName: resource.label,
            reason: 'kept-running',
            detail: outcome.detail,
          });
          report.refused.push(id);
          report.hadFailure = true;
          return;
        case 'needs-permission':
        case 'failed':
          console.error(`Couldn't close ${resource.label}: ${outcome.detail}`);
          report.leftOpen.push({
            appName: resource.label,
            reason: outcome.outcome,
            detail: outcome.detail,
          });
          report.hadFailure = true;
          return;
      }
    });
  }
  return report;
}

/** One workspace step's claim on one resource. */
export interface Claim {
  resourceId: string;
  owner: ResourceOwner;
}

/**
 * The workspace's claims that no longer match its steps: a step that
 * was removed, or a step that was edited so it now needs something
 * else (a terminal whose command changed is a different terminal). The
 * claimed resource is the old version — no step will ever reuse it, so
 * keeping the claim would only leak it.
 *
 * `currentKeys` is each tracked step's current identity keys; a step
 * missing from it has no valid claims — unless it's in `unresolved`:
 * a step that still exists but came out untracked this time (VS Code's
 * bundle couldn't be read, say). Its claims are kept: closing what
 * it's about to use on a passing lookup failure is worse than a leak.
 */
export function staleClaims(
  store: ResourceLedgerStore,
  workspaceId: string,
  currentKeys: ReadonlyMap<string, ReadonlySet<string>>,
  unresolved: ReadonlySet<string> = new Set(),
): Claim[] {
  return resourcesOwnedBy(store.get(), workspaceId).flatMap((resource) =>
    resource.owners
      .filter(
        (o) =>
          o.workspaceId === workspaceId &&
          !unresolved.has(o.stepId) &&
          !(currentKeys.get(o.stepId)?.has(resource.identityKey) ?? false),
      )
      .map((owner) => ({ resourceId: resource.id, owner })),
  );
}

/**
 * Releases these claims; with `close`, also closes what that leaves
 * ownerless and ours (the same rules as Close). Without it nothing is
 * closed, even if something became ownerless — the user didn't agree
 * to close it. A refused close gets its claims back.
 */
export async function releaseClaims(
  store: ResourceLedgerStore,
  claims: readonly Claim[],
  context: CloseContext,
  close: boolean,
): Promise<CloseReport> {
  for (const { resourceId, owner } of claims) {
    store.update((l) => (findResource(l, resourceId) ? removeOwner(l, resourceId, owner) : l));
  }
  const ids = [...new Set(claims.map((c) => c.resourceId))];
  if (!close) return { closed: [], leftOpen: [], hadFailure: false, refused: [] };
  const report = await closeOwnerless(store, ids, context);
  const ownersById = new Map<string, ResourceOwner[]>();
  for (const { resourceId, owner } of claims) {
    ownersById.set(resourceId, [...(ownersById.get(resourceId) ?? []), owner]);
  }
  restoreClaims(store, report.refused, ownersById);
  return report;
}

/**
 * What releasing these claims would close right now: resources this
 * app opened that only these claims hold, that are still running, and
 * that nothing else needs by app name. Asked about before a save that
 * would release them (the Detail view and the Edit form); anything
 * else is let go of silently.
 */
export async function previewClaimRelease(
  store: ResourceLedgerStore,
  claims: readonly Claim[],
  context: CloseContext,
): Promise<string[]> {
  const labels: string[] = [];
  for (const resourceId of new Set(claims.map((c) => c.resourceId))) {
    const resource = findResource(store.get(), resourceId);
    if (!resource || !resource.createdByApp || resource.handle === null) continue;
    const releasing = claims.filter((c) => c.resourceId === resourceId);
    const keepsAnOwner = resource.owners.some(
      (o) =>
        !releasing.some(
          (c) => c.owner.workspaceId === o.workspaceId && c.owner.stepId === o.stepId,
        ),
    );
    if (keepsAnOwner) continue;
    const kind = getResourceKind(resource.kind);
    if (!kind) continue;
    if (kind.closesWholeApp && resource.appName !== undefined) {
      const appName = resource.appName;
      const usedInside = store
        .get()
        .resources.some(
          (r) => r.id !== resource.id && r.owners.length > 0 && r.appName === appName,
        );
      if (context.untrackedAppNamesInUse.has(appName) || usedInside) continue;
    }
    const identity = JSON.parse(resource.identityKey) as ResourceSpec['identity'];
    const state = await kind.check(resource.handle, identity);
    if (state.state === 'alive' || state.state === 'unknown') labels.push(resource.label);
  }
  return labels;
}

/**
 * Retry's teardown: this step's own claims on resources that running
 * it again would duplicate (non-idempotent kinds) are released and
 * closed. Idempotent ones (apps) keep their claim — re-running an app
 * step never makes a second instance, so there's nothing to clear.
 */
export async function releaseStepForRetry(
  store: ResourceLedgerStore,
  workspaceId: string,
  stepId: string,
  context: CloseContext,
): Promise<CloseReport> {
  const owner: ResourceOwner = { workspaceId, stepId };
  const ids = resourcesOwnedBy(store.get(), workspaceId, stepId)
    .filter((r) => getResourceKind(r.kind)?.openIsIdempotent === false)
    .map((r) => r.id);
  for (const id of ids) store.update((l) => removeOwner(l, id, owner));
  const report = await closeOwnerless(store, ids, context);
  restoreClaims(store, report.refused, new Map(ids.map((id) => [id, [owner]])));
  return report;
}

/**
 * Drops ledger entries for resources that are provably gone, so a
 * workspace whose apps were quit outside this app stops counting as
 * active. 'unknown' (couldn't check) keeps them.
 */
export async function revalidateOwned(store: ResourceLedgerStore): Promise<void> {
  for (const resource of store.get().resources) {
    if (resource.owners.length === 0 || resource.state !== 'open') continue;
    const kind = getResourceKind(resource.kind);
    if (!kind || resource.handle === null) {
      store.update((l) => removeResource(l, resource.id));
      continue;
    }
    const identity = JSON.parse(resource.identityKey) as ResourceSpec['identity'];
    const state = await kind.check(resource.handle, identity);
    if (state.state === 'gone' || state.state === 'drifted') {
      store.update((l) => (findResource(l, resource.id) ? removeResource(l, resource.id) : l));
    } else if (state.state === 'alive' && state.handle) {
      recordHandle(store, resource.id, state.handle);
    }
  }
}

/** Ledger-side "is this workspace active" (it owns something). */
export function ownsResources(store: ResourceLedgerStore, workspaceId: string): boolean {
  return isWorkspaceActive(store.get(), workspaceId);
}

/**
 * Whether any workspace currently owns a resource that lives in this
 * app (by app-level name) — the app-level path never quits such an app.
 */
export function isAppOwned(store: ResourceLedgerStore, appName: string): boolean {
  return store
    .get()
    .resources.some((r) => r.owners.length > 0 && (r.appName ?? r.label) === appName);
}

/**
 * For "Save current workspace": whatever a tracked step would open
 * that's already running is recorded as the workspace's, but not
 * ours — saving a workspace never makes this app the one that closes
 * the user's own apps.
 */
export async function adoptRunning(
  store: ResourceLedgerStore,
  workspaceId: string,
  tracked: readonly TrackedStep[],
): Promise<void> {
  for (const { step, specs } of tracked) {
    const owner: ResourceOwner = { workspaceId, stepId: step.id };
    for (const spec of specs) {
      const kind = getResourceKind(spec.kind)!;
      await locks.withLocks([identityLockKey(spec.kind, identityKeyFor(spec))], async () => {
        const live = await findLiveResource(store, kind, spec);
        if (live) {
          store.update((l) => addOwner(l, live.id, owner));
          return;
        }
        const handle = await kind.findLive(spec.identity);
        if (!handle) return;
        store.update(
          (l) =>
            addResource(l, {
              kind: spec.kind,
              identityKey: identityKeyFor(spec),
              label: spec.label,
              ...(spec.appName === undefined ? {} : { appName: spec.appName }),
              owner,
              createdByApp: false,
              handle,
              state: 'open',
            }).ledger,
        );
      });
    }
  }
}
