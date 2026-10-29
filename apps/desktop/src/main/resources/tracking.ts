import type {
  LeftOpenEntry,
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
import type { ResourceKindPlugin } from './types';

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
    const specs = getLedgerStore() ? await specsFor(step) : [];
    if (specs.length > 0 && specs.every((s) => getResourceKind(s.kind))) {
      tracked.push({ step, specs });
    } else {
      untracked.push(step);
    }
  }
  return { tracked, untracked };
}

async function specsFor(step: WorkspaceStep): Promise<ResourceSpec[]> {
  const tool = getTool(step.type);
  if (!tool?.resources) return [];
  const validation = tool.validate(step.params);
  if (!validation.valid) return [];
  try {
    return await tool.resources(validation.data);
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
  run: () => Promise<StepResult>,
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

    for (const spec of specs) {
      const kind = getResourceKind(spec.kind)!;
      const live = await findLiveResource(store, kind, spec);
      if (live) {
        store.update((l) => addOwner(l, live.id, owner));
        if (kind.openIsIdempotent) mustRun = true;
        continue;
      }
      const snapshot = await kind.snapshot(spec.identity);
      let opening!: Resource;
      store.update((l) => {
        const added = addResource(l, {
          kind: spec.kind,
          identityKey: identityKeyFor(spec),
          label: spec.label,
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

    const result = mustRun ? await run() : { ...REUSED_RESULT, durationMs: 0 };

    for (const { spec, kind, id, snapshot } of pending) {
      const captured = await kind.capture(spec.identity, snapshot);
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
      }
    }
    return result;
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
    if (state.state === 'alive' || state.state === 'unknown') return resource;
    store.update((l) => removeResource(l, resource.id));
  }
  return undefined;
}

export interface CloseReport {
  closed: string[];
  leftOpen: LeftOpenEntry[];
  /** Something this app should have closed is still open (failed / needs permission). */
  hadFailure: boolean;
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
  const affected = resourcesOwnedBy(store.get(), workspaceId)
    .filter(
      (r) =>
        stepIds === undefined ||
        r.owners.some((o) => o.workspaceId === workspaceId && stepIds.has(o.stepId)),
    )
    .map((r) => r.id);
  store.update((l) => releaseWorkspace(l, workspaceId, stepIds));
  const report = await closeOwnerless(store, affected, context);
  if (context.reportStillClaimed) {
    for (const id of affected) {
      const resource = findResource(store.get(), id);
      if (!resource || resource.owners.length === 0) continue;
      report.leftOpen.push({
        appName: resource.label,
        reason: 'still-used',
        usedBy: [...new Set(resource.owners.map((o) => o.workspaceId))],
      });
    }
  }
  return report;
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
  const report: CloseReport = { closed: [], leftOpen: [], hadFailure: false };
  for (const id of resourceIds) {
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
      if (context.untrackedAppNamesInUse.has(resource.label)) {
        report.leftOpen.push({ appName: resource.label, reason: 'still-used' });
        drop();
        return;
      }
      const kind = getResourceKind(resource.kind);
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

/**
 * After a run: claims by steps that are no longer in the workspace
 * (edited out since they opened something) are released and closed if
 * ownerless — an edit never orphans a resource. `context` is only
 * worked out when there's something to release, which is rare.
 */
export async function reconcileRemovedSteps(
  store: ResourceLedgerStore,
  config: WorkspaceConfig,
  context: () => Promise<CloseContext>,
): Promise<CloseReport> {
  const removed = removedStepIds(store, config);
  if (removed.size === 0) return { closed: [], leftOpen: [], hadFailure: false };
  return releaseAndClose(store, config.id, await context(), removed);
}

/** Ids of steps this workspace still has claims for but no longer contains. */
export function removedStepIds(store: ResourceLedgerStore, config: WorkspaceConfig): Set<string> {
  const current = new Set(config.steps.map((s) => s.id));
  return new Set(
    resourcesOwnedBy(store.get(), config.id)
      .flatMap((r) => r.owners)
      .filter((o) => o.workspaceId === config.id && !current.has(o.stepId))
      .map((o) => o.stepId),
  );
}

/**
 * What removing one step would close right now: resources this app
 * opened that only this step claims (not another workspace, not
 * another step of the same one), that are still running, and that no
 * active workspace's untracked step uses by name. The Detail view asks
 * before removing such a step; anything else is removed silently.
 */
export async function previewStepRemoval(
  store: ResourceLedgerStore,
  workspaceId: string,
  stepId: string,
  context: CloseContext,
): Promise<string[]> {
  const labels: string[] = [];
  for (const resource of resourcesOwnedBy(store.get(), workspaceId, stepId)) {
    const onlyThisStep = resource.owners.every(
      (o) => o.workspaceId === workspaceId && o.stepId === stepId,
    );
    if (!onlyThisStep || !resource.createdByApp || resource.handle === null) continue;
    if (context.untrackedAppNamesInUse.has(resource.label)) continue;
    const kind = getResourceKind(resource.kind);
    if (!kind) continue;
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
  return closeOwnerless(store, ids, context);
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
    }
  }
}

/** Ledger-side "is this workspace active" (it owns something). */
export function ownsResources(store: ResourceLedgerStore, workspaceId: string): boolean {
  return isWorkspaceActive(store.get(), workspaceId);
}

/** Whether any workspace currently owns a resource with this label (app name). */
export function isLabelOwned(store: ResourceLedgerStore, label: string): boolean {
  return store.get().resources.some((r) => r.label === label && r.owners.length > 0);
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
