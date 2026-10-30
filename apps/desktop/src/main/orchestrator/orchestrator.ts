import { basename } from 'node:path';
import type {
  ApplyStepsChangeResult,
  CloseResult,
  LeftOpenEntry,
  RestoreProgressEvent,
  StepResult,
  SwitchResult,
  WorkspaceConfig,
  WorkspaceStep,
} from '@workspace-launcher/shared';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { getTool } from '../tools/registry';
import { formatInvalidParamsError } from '../tools/validate-steps';
import { getStepTimeoutMs, recordSuccessfulStepDuration } from './step-timing-history';
import { getMacAppName, isExcludedFromAutoClose } from './tool-identity';
import { isAppRunning, quitApp, waitForAppRunning } from '../platform/macos/process-control';
import { isIntentActive, setIntentActive } from './workspace-activity-store';
import { identityKeyFor } from '../resources/kind-registry';
import { VSCODE_WINDOW_KIND } from '../resources/kinds/vscode-window-spec';
import { releaseWorkspace, resourcesOwnedBy } from '../resources/ledger';
import type { ResourceLedgerStore } from '../resources/ledger-store';
import { getLedgerStore } from '../resources/runtime';
import {
  adoptRunning,
  isAppOwned,
  locks,
  openTrackedStep,
  ownsResources,
  previewClaimRelease,
  releaseAndClose,
  releaseClaims,
  releaseStepForRetry,
  resolveTrackedSteps,
  revalidateOwned,
  staleClaims,
  workspaceLockKey,
  type CloseReport,
  type TrackedStep,
} from '../resources/tracking';

/*
 * Two kinds of step live side by side here (WCs/WC__window-tracking.md,
 * "Phase 2, slice 4 technical plan"):
 *
 * - TRACKED steps (their tool declares resources — resources/
 *   tracking.ts) are opened, reused and closed through the resource
 *   ledger: per resource, only what this app opened and nothing else
 *   still claims is ever closed.
 * - UNTRACKED steps keep the original app-level model: intent (this
 *   workspace was Restored and not yet Closed) AND liveness (an app it
 *   needs, by name, is running) — see WCs/WC__workspace-activity.md.
 *
 * Neither quits what the other still uses: the untracked path never
 * quits an app a ledger resource is owned for, and the ledger never
 * closes an app an active workspace's untracked step uses by name.
 *
 * Every public operation holds its workspace's lock for its whole
 * duration (tracking.ts's `locks`), so Restore/Close/Switch/Retry on
 * one workspace never interleave.
 */

export interface RunWorkspaceOptions {
  /** Optional live per-step signal — see restore-progress.ts's own doc
   * comment for why this is deliberately minimal. Electron-free by
   * design: this file stays platform-agnostic and independently
   * unit-testable, so the caller (handlers.ts) is what actually wires
   * this into an IPC push, not anything in here. */
  onStepProgress?: (event: RestoreProgressEvent) => void;
  /**
   * Every workspace config, for the end-of-run cleanup of resources
   * claimed by steps since edited out of this one (it has to know what
   * the other workspaces still use before closing anything). Without
   * it, that cleanup is skipped — it runs again on the next restore.
   */
  allConfigs?: WorkspaceConfig[];
}

/** A config with its steps split into tracked and untracked ones. */
interface PartitionedConfig {
  config: WorkspaceConfig;
  tracked: TrackedStep[];
  untracked: WorkspaceStep[];
}

async function partition(configs: readonly WorkspaceConfig[]): Promise<PartitionedConfig[]> {
  return Promise.all(
    configs.map(async (config) => ({ config, ...(await resolveTrackedSteps(config)) })),
  );
}

/**
 * Runs every step of a workspace config in order, via whatever tool
 * module is registered for its `type` — tracked steps through the
 * ledger (reuse what's live, record what's opened), untracked ones
 * directly. Fails loudly (never silently) when a tool type isn't
 * registered or params are invalid — per claude.md's no-silent-failure
 * rule.
 */
export async function runWorkspace(
  config: WorkspaceConfig,
  options: RunWorkspaceOptions = {},
): Promise<StepResult[]> {
  return locks.withLocks([workspaceLockKey(config.id)], () =>
    runWorkspaceHoldingLock(config, options),
  );
}

async function runWorkspaceHoldingLock(
  config: WorkspaceConfig,
  options: RunWorkspaceOptions,
): Promise<StepResult[]> {
  // Restoring (via this function, whether directly or as Switch's own
  // open phase) is what "Active" means by definition for untracked
  // steps — see WCs/WC__workspace-activity.md's "intent AND liveness"
  // rule. Set unconditionally, regardless of per-step outcomes:
  // liveness still independently gates the DISPLAYED active state.
  setIntentActive(config.id, true);

  const store = getLedgerStore();
  const { tracked } = await resolveTrackedSteps(config);
  const trackedById = new Map(tracked.map((t) => [t.step.id, t]));

  const results: StepResult[] = [];

  for (const [stepIndex, step] of config.steps.entries()) {
    options.onStepProgress?.({
      workspaceId: config.id,
      stepIndex,
      total: config.steps.length,
      status: 'running',
    });
    const trackedStep = trackedById.get(step.id);
    const result =
      store && trackedStep
        ? await openTrackedStep(store, config.id, trackedStep, (liveResourceKeys) =>
            runStep(step, config.id, liveResourceKeys),
          )
        : await runStep(step, config.id);
    results.push(result);
    options.onStepProgress?.({
      workspaceId: config.id,
      stepIndex,
      total: config.steps.length,
      status: result.success ? 'success' : 'failure',
      message: result.message,
    });
  }

  const allConfigs = options.allConfigs;
  if (store && allConfigs) {
    const claims = staleClaims(
      store,
      config.id,
      currentKeys(tracked),
      unresolvedStepIds(config, tracked),
    );
    if (claims.length > 0) {
      const report = await releaseClaims(
        store,
        claims,
        { untrackedAppNamesInUse: await otherWorkspacesAppNames(config, allConfigs) },
        true,
      );
      logReport(`cleaning up steps edited out of "${config.name}"`, report);
    }
  }

  return results;
}

/**
 * Re-runs exactly one step by index and returns its fresh result — the
 * orchestrator half of the Detail view's per-failed-step Retry button
 * (handlers.ts's retryWorkspaceStep/workspaces:retryStep). A tracked
 * step first has its own duplicate-prone resources closed (the
 * motivating bug: Retry opening a second window next to the failed
 * one), then opens like a Restore. Never throws: an out-of-range index
 * is a failed StepResult, so every caller can treat every outcome of a
 * retry attempt uniformly.
 */
export async function retryStep(
  config: WorkspaceConfig,
  stepIndex: number,
  allConfigs: WorkspaceConfig[] = [config],
): Promise<StepResult> {
  const step = config.steps[stepIndex];
  if (!step) {
    return {
      success: false,
      message: `No step at index ${stepIndex} (workspace has ${config.steps.length}).`,
      durationMs: 0,
      code: ERROR_CODES.RETRY_STEP_NOT_FOUND.code,
    };
  }
  return locks.withLocks([workspaceLockKey(config.id)], async () => {
    const store = getLedgerStore();
    const trackedStep = (await resolveTrackedSteps(config)).tracked.find(
      (t) => t.step.id === step.id,
    );
    if (!store || !trackedStep) return runStep(step, config.id);

    const report = await releaseStepForRetry(store, config.id, step.id, {
      untrackedAppNamesInUse: await untrackedAppNamesInUse(
        await partition(allConfigs.filter((c) => c.id !== config.id)),
      ),
    });
    logReport(`clearing "${step.type}" before retrying it`, report);
    if (report.hadFailure) {
      // Re-running now would open a second copy next to the one that
      // didn't close — or quietly "reuse" it, which isn't a retry.
      const problems = report.leftOpen
        .filter((e) => e.reason !== 'still-used' && e.reason !== 'not-ours')
        .map((e) => `${e.appName}${e.detail ? ` (${e.detail})` : ''}`);
      return {
        success: false,
        message: `Couldn't close ${problems.join(', ') || 'the previous attempt'} before retrying — close it, then retry again.`,
        durationMs: 0,
        code: ERROR_CODES.STEP_FAILED.code,
      };
    }
    return openTrackedStep(store, config.id, trackedStep, (liveResourceKeys) =>
      runStep(step, config.id, liveResourceKeys),
    );
  });
}

/**
 * Every distinct macOS app name the given steps map to (tool-identity.ts),
 * deduplicated — two VS Code steps still contribute "Visual Studio
 * Code" once.
 */
function appNamesOf(steps: readonly WorkspaceStep[]): string[] {
  const names = new Set<string>();
  for (const step of steps) {
    const name = getMacAppName(step.type, step.params);
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * The steps that take the app-level path for this config: its
 * untracked steps, plus — the upgrade case — tracked steps of a
 * workspace that was made active before tracking existed and so owns
 * nothing for them. Those get the app-level close one last time
 * instead of being silently left open.
 */
function appLevelSteps(
  store: ResourceLedgerStore | null,
  part: PartitionedConfig,
): WorkspaceStep[] {
  if (!store || !isIntentActive(part.config.id)) return part.untracked;
  const unowned = part.tracked
    .filter((t) => resourcesOwnedBy(store.get(), part.config.id, t.step.id).length === 0)
    // Never VS Code: the app-level close quits every VS Code window,
    // including ones the user opened for other projects — and without a
    // tracked window, VS Code is left open (WCs/WC__window-tracking.md,
    // slice 6's no-extension decision).
    .filter((t) => !t.specs.some((spec) => spec.kind === VSCODE_WINDOW_KIND))
    .map((t) => t.step);
  return [...part.untracked, ...unowned];
}

/**
 * Checks liveness for every distinct app name the given steps map to,
 * in one batch (deduped, parallelized) — avoids re-checking the same
 * app name once per config/step when several workspaces share it.
 */
async function runningAppNameMap(steps: readonly WorkspaceStep[]): Promise<Map<string, boolean>> {
  const names = appNamesOf(steps);
  const liveness = await Promise.all(names.map((name) => isAppRunning(name)));
  return new Map(names.map((name, i) => [name, liveness[i]!]));
}

/** Every app name that maps from a step type excluded from auto-close (today: only 'chrome'). */
function excludedAppNames(steps: readonly WorkspaceStep[]): Set<string> {
  return new Set(appNamesOf(steps.filter((step) => isExcludedFromAutoClose(step.type))));
}

/**
 * Active = it owns a ledger resource, OR (app-level steps) it was
 * explicitly Restored/Switched-to and not yet Closed (intent) AND
 * something it needs is still running (liveness). Liveness alone can
 * only turn the app-level half false, never true for a workspace nobody
 * touched — see WCs/WC__workspace-activity.md for why.
 */
function isActive(
  store: ResourceLedgerStore | null,
  part: PartitionedConfig,
  runningAppNames: Map<string, boolean>,
): boolean {
  if (store && ownsResources(store, part.config.id)) return true;
  if (!isIntentActive(part.config.id)) return false;
  // Untracked steps only: a tracked step's activity comes from the
  // ledger alone. Counting it by app name too would keep a workspace
  // activated before tracking existed "active" forever whenever the app
  // happens to be running (a link opened in VS Code, with VS Code open
  // for something else).
  return appNamesOf(part.untracked).some((name) => runningAppNames.get(name) === true);
}

/** App names the untracked steps of the given (active) workspaces use. */
async function untrackedAppNamesInUse(parts: readonly PartitionedConfig[]): Promise<Set<string>> {
  const store = getLedgerStore();
  const running = await runningAppNameMap(parts.flatMap((p) => appLevelSteps(store, p)));
  const names = new Set<string>();
  for (const part of parts) {
    if (!isActive(store, part, running)) continue;
    for (const name of appNamesOf(appLevelSteps(store, part))) names.add(name);
  }
  return names;
}

/**
 * The ids of every currently active workspace — what the sidebar's
 * "Active" badge shows (handlers.ts's listWorkspaces). Ledger entries
 * whose resource has provably gone (quit outside this app) are dropped
 * first, so they stop counting.
 */
export async function getActiveWorkspaceIds(configs: WorkspaceConfig[]): Promise<Set<string>> {
  const store = getLedgerStore();
  if (store) await revalidateOwned(store);
  const parts = await partition(configs);
  const running = await runningAppNameMap(parts.flatMap((p) => appLevelSteps(store, p)));
  return new Set(parts.filter((p) => isActive(store, p, running)).map((p) => p.config.id));
}

/**
 * "Save current workspace" just saved a workspace from what's running:
 * everything in it was, by construction, already open — so it's active
 * (intent), and its tracked steps' running apps are recorded as its
 * resources, but never as opened by this app (decision 1).
 */
export async function markWorkspaceDetectedActive(config: WorkspaceConfig): Promise<void> {
  setIntentActive(config.id, true);
  const store = getLedgerStore();
  if (!store) return;
  await locks.withLocks([workspaceLockKey(config.id)], async () => {
    await adoptRunning(store, config.id, (await resolveTrackedSteps(config)).tracked);
  });
}

/** Each tracked step's current identity keys — what its claims must match to stay valid. */
function currentKeys(tracked: readonly TrackedStep[]): Map<string, Set<string>> {
  return new Map(
    tracked.map((t) => [t.step.id, new Set(t.specs.map((spec) => identityKeyFor(spec)))]),
  );
}

/**
 * Steps that came out untracked this time — for a tracked kind, its
 * resources couldn't be resolved just now — see staleClaims.
 */
function unresolvedStepIds(config: WorkspaceConfig, tracked: readonly TrackedStep[]): Set<string> {
  const resolved = new Set(tracked.map((t) => t.step.id));
  return new Set(config.steps.filter((step) => !resolved.has(step.id)).map((step) => step.id));
}

/**
 * App names an untracked step still uses — in other workspaces, and in
 * this one too (`config`, as it is now): a stale claim on an app is
 * never quit while one of this workspace's own app-level steps uses it.
 */
async function otherWorkspacesAppNames(
  config: WorkspaceConfig,
  allConfigs: readonly WorkspaceConfig[],
): Promise<Set<string>> {
  const others = await partition(allConfigs.filter((c) => c.id !== config.id));
  const [own] = await partition([config]);
  const names = await untrackedAppNamesInUse(others);
  for (const name of appNamesOf(own!.untracked)) names.add(name);
  return names;
}

/**
 * What saving `proposed` (this workspace with edited steps, not saved
 * yet) would close right now: the running things this app opened for
 * steps it removes or changes, that nothing else uses — see
 * tracking.ts's previewClaimRelease. The Detail view and the Edit form
 * ask before such a save; empty means save without asking.
 */
export async function previewStepsChange(
  proposed: WorkspaceConfig,
  allConfigs: WorkspaceConfig[],
): Promise<string[]> {
  const store = getLedgerStore();
  if (!store) return [];
  const { tracked } = await resolveTrackedSteps(proposed);
  return locks.withLocks([workspaceLockKey(proposed.id)], async () =>
    previewClaimRelease(
      store,
      staleClaims(store, proposed.id, currentKeys(tracked), unresolvedStepIds(proposed, tracked)),
      {
        untrackedAppNamesInUse: await otherWorkspacesAppNames(proposed, allConfigs),
      },
    ),
  );
}

/**
 * Right after a saved edit to this workspace: claims of removed or
 * changed steps are released — with `close` (the user confirmed) also
 * closing what that leaves ownerless and ours — and every changed step
 * runs again with its new settings, so a
 * running workspace reflects the edit at once (a terminal whose command
 * changed is replaced by one running the new command).
 */
export async function applyStepsChange(
  config: WorkspaceConfig,
  allConfigs: WorkspaceConfig[],
  close: boolean,
): Promise<ApplyStepsChangeResult> {
  const store = getLedgerStore();
  if (!store) return { closed: [], leftOpen: [], stepResults: [] };
  return locks.withLocks([workspaceLockKey(config.id)], async () => {
    const { tracked } = await resolveTrackedSteps(config);
    const claims = staleClaims(
      store,
      config.id,
      currentKeys(tracked),
      unresolvedStepIds(config, tracked),
    );
    const report = await releaseClaims(
      store,
      claims,
      { untrackedAppNamesInUse: await otherWorkspacesAppNames(config, allConfigs) },
      close,
    );
    const changed = new Set(claims.map((c) => c.owner.stepId));
    const stepResults: ApplyStepsChangeResult['stepResults'] = [];
    for (const trackedStep of tracked.filter((t) => changed.has(t.step.id))) {
      const { step } = trackedStep;
      const result = await openTrackedStep(store, config.id, trackedStep, (liveResourceKeys) =>
        runStep(step, config.id, liveResourceKeys),
      );
      stepResults.push({ stepId: step.id, result });
    }
    return { closed: report.closed, leftOpen: report.leftOpen, stepResults };
  });
}

/** A deleted workspace owns nothing from then on; deleting never closes anything. */
export function releaseDeletedWorkspace(workspaceId: string): void {
  getLedgerStore()?.update((ledger) => releaseWorkspace(ledger, workspaceId));
}

/**
 * Attempts to stop one Docker step's containers, but ONLY when its own
 * `stopOnClose` opt-in is set (default off — docker-tool.ts: containers
 * can hold real, expensive-to-rebuild state, so this is never automatic).
 * Mutates `closed`/`leftOpen` directly, reusing their existing shape —
 * Docker steps have no macOS app name, so a descriptive label stands in
 * for one. Returns false only on a real attempted-and-failed teardown,
 * so callers can withhold `setIntentActive(..., false)` the same way an
 * unresolved app-quit failure already does.
 */
async function teardownDockerStepIfEnabled(
  step: WorkspaceConfig['steps'][number],
  closed: string[],
  leftOpen: LeftOpenEntry[],
): Promise<boolean> {
  if (step.type !== 'docker') return true;
  const tool = getTool('docker');
  if (!tool) return true; // not registered — nothing to do, not a failure
  const validation = tool.validate(step.params);
  if (!validation.valid) return true; // invalid config — nothing meaningful to tear down
  const data = validation.data as { stopOnClose?: boolean; directory?: string };
  if (data.stopOnClose !== true) return true; // opt-in off — leave running, by design
  const label = `Docker (${typeof data.directory === 'string' ? basename(data.directory) : 'stack'})`;
  const result = await tool.teardown(validation.data);
  if (result.success) {
    closed.push(label);
    return true;
  }
  console.error(`Failed to stop Docker containers for "${label}": ${result.message}`);
  leftOpen.push({ appName: label, reason: 'failed', detail: result.message });
  return false;
}

/**
 * Full context change: closes whatever another currently-ACTIVE
 * workspace opened that this target doesn't need, then restores the
 * target.
 *
 * Tracked: every other workspace's claims are released; whatever that
 * leaves ownerless is closed, except resources the target is about to
 * reuse (same identity) — those transfer to it instead of being closed
 * and reopened.
 *
 * App-level: the "currently running" set is intentionally NOT "every
 * app name in every known config" — only an app belonging to a
 * workspace this app itself made active is ever a candidate, so a real
 * app you have open for unrelated work is never closed just because
 * some config mentions the same name.
 */
export async function switchToWorkspace(
  target: WorkspaceConfig,
  allConfigs: WorkspaceConfig[],
): Promise<SwitchResult> {
  return locks.withLocks([workspaceLockKey(target.id)], async () => {
    const store = getLedgerStore();
    const parts = await partition(allConfigs);
    const targetPart =
      parts.find((p) => p.config.id === target.id) ?? (await partition([target]))[0]!;
    const others = parts.filter((p) => p.config.id !== target.id);

    const targetSpecs = targetPart.tracked.flatMap((t) => t.specs);
    const targetAppNames = new Set([
      ...appNamesOf(targetPart.untracked),
      ...targetSpecs.map((spec) => spec.appName ?? spec.label),
    ]);
    const runningAppNames = await runningAppNameMap(parts.flatMap((p) => appLevelSteps(store, p)));
    // Decided before anything is released: owning resources is part of
    // what "active" means.
    const activeOthers = others.filter((p) => isActive(store, p, runningAppNames));

    const closed: string[] = [];
    const leftOpen: LeftOpenEntry[] = [];
    const failedWorkspaceIds = new Set<string>();

    if (store) {
      const keepIdentityKeys = new Set(targetSpecs.map((spec) => identityKeyFor(spec)));
      for (const other of others) {
        const report = await releaseAndClose(store, other.config.id, {
          untrackedAppNamesInUse: targetAppNames,
          keepIdentityKeys,
        });
        mergeReport(report, closed, leftOpen);
        if (report.hadFailure) failedWorkspaceIds.add(other.config.id);
      }
    }

    const candidateAppNames = new Set(
      activeOthers.flatMap((p) => appNamesOf(appLevelSteps(store, p))),
    );
    const excluded = excludedAppNames(parts.flatMap((p) => appLevelSteps(store, p)));
    const failedAppNames = new Set<string>();

    for (const [appName, running] of runningAppNames) {
      if (!running || targetAppNames.has(appName)) continue;
      if (!candidateAppNames.has(appName)) continue;
      if (excluded.has(appName)) {
        leftOpen.push({ appName, reason: 'excluded' });
        continue;
      }
      if (store && isAppOwned(store, appName)) {
        leftOpen.push({ appName, reason: 'still-used' });
        continue;
      }
      const result = await quitApp(appName);
      if (result.success) {
        closed.push(appName);
      } else {
        console.error(`Failed to quit "${appName}" while switching workspaces: ${result.message}`);
        failedAppNames.add(appName);
        leftOpen.push({ appName, reason: 'failed', detail: result.message });
      }
    }

    // Full context change — but never claim another workspace went
    // inactive if something it needed failed to actually close (app,
    // tracked resource or Docker); leave its intent untouched so
    // liveness keeps reflecting reality for it.
    for (const other of others) {
      const hasUnresolvedFailure =
        failedWorkspaceIds.has(other.config.id) ||
        appNamesOf(appLevelSteps(store, other)).some((name) => failedAppNames.has(name));
      let dockerOk = true;
      // Intent alone, NOT isActive — a Docker step has no macOS app
      // name (getMacAppName returns undefined for it), so a workspace
      // made up only of Docker steps can never satisfy the liveness
      // half regardless of whether its containers are actually
      // running. Intent is the correct, and only available, signal for
      // "does this config's own Docker teardown need to run."
      // App-level steps only: a tracked Compose stack was already
      // handled through the ledger above.
      if (!hasUnresolvedFailure && isIntentActive(other.config.id)) {
        for (const step of appLevelSteps(store, other)) {
          const ok = await teardownDockerStepIfEnabled(step, closed, leftOpen);
          if (!ok) dockerOk = false;
        }
      }
      if (!hasUnresolvedFailure && dockerOk) {
        setIntentActive(other.config.id, false);
      }
    }

    // runWorkspaceHoldingLock sets the target's own intent and reuses
    // the transferred resources, adding the target as their owner.
    const stepResults = await runWorkspaceHoldingLock(target, { allConfigs });

    return { stepResults, closed, leftOpen };
  });
}

/**
 * Closes only this workspace's own apps and resources — never opens
 * anything, never touches another workspace. Tracked: releases its
 * claims and closes what that leaves ownerless and this app opened.
 * App-level: skips anything excluded (Chrome) or still needed by
 * another currently-active workspace.
 */
export async function closeWorkspace(
  target: WorkspaceConfig,
  allConfigs: WorkspaceConfig[],
): Promise<CloseResult> {
  return locks.withLocks([workspaceLockKey(target.id)], async () => {
    const store = getLedgerStore();
    const parts = await partition(allConfigs);
    const targetPart =
      parts.find((p) => p.config.id === target.id) ?? (await partition([target]))[0]!;
    const others = parts.filter((p) => p.config.id !== target.id);
    // Worked out before releasing anything, while the target's own
    // claims still decide which of its steps take the app-level path.
    const targetAppLevelSteps = appLevelSteps(store, targetPart);
    const runningAppNames = await runningAppNameMap([
      ...targetAppLevelSteps,
      ...others.flatMap((p) => appLevelSteps(store, p)),
    ]);

    const otherNeeds = new Set<string>();
    for (const other of others) {
      if (!isActive(store, other, runningAppNames)) continue;
      for (const name of appNamesOf(appLevelSteps(store, other))) {
        otherNeeds.add(name);
      }
    }

    const closed: string[] = [];
    const leftOpen: LeftOpenEntry[] = [];
    let hadFailure = false;

    if (store) {
      const report = await releaseAndClose(store, target.id, {
        untrackedAppNamesInUse: otherNeeds,
        reportStillClaimed: true,
      });
      // Ledger owners are workspace ids; the result shows their names.
      const nameOf = new Map(allConfigs.map((c) => [c.id, c.name]));
      for (const entry of report.leftOpen) {
        if (entry.usedBy) entry.usedBy = entry.usedBy.map((id) => nameOf.get(id) ?? id);
      }
      mergeReport(report, closed, leftOpen);
      hadFailure = report.hadFailure;
    }

    for (const step of targetAppLevelSteps) {
      if (step.type === 'docker') {
        const ok = await teardownDockerStepIfEnabled(step, closed, leftOpen);
        if (!ok) hadFailure = true;
        continue;
      }
      const appName = getMacAppName(step.type, step.params);
      if (!appName) continue;
      // Liveness first: an app that was never running shouldn't produce
      // a "left running" report at all, excluded/still-used or not.
      if (runningAppNames.get(appName) !== true) continue;
      if (isExcludedFromAutoClose(step.type)) {
        leftOpen.push({ appName, reason: 'excluded' });
        continue;
      }
      if (otherNeeds.has(appName) || (store && isAppOwned(store, appName))) {
        leftOpen.push({ appName, reason: 'still-used' });
        continue;
      }
      const result = await quitApp(appName);
      if (result.success) {
        closed.push(appName);
      } else {
        console.error(
          `Failed to quit "${appName}" while closing workspace "${target.id}": ${result.message}`,
        );
        hadFailure = true;
        leftOpen.push({ appName, reason: 'failed', detail: result.message });
      }
    }

    // Never claim this workspace is inactive if something it needed
    // failed to actually close — liveness would otherwise be overridden
    // by a false "not active" the next time it's checked.
    if (!hadFailure) {
      setIntentActive(target.id, false);
    }
    return { closed, leftOpen };
  });
}

function mergeReport(report: CloseReport, closed: string[], leftOpen: LeftOpenEntry[]): void {
  closed.push(...report.closed);
  leftOpen.push(...report.leftOpen);
}

/** Housekeeping closes (reconcile, retry) have no result screen — failures are logged. */
function logReport(context: string, report: CloseReport): void {
  for (const entry of report.leftOpen) {
    if (entry.reason === 'failed' || entry.reason === 'needs-permission') {
      console.error(`While ${context}: couldn't close ${entry.appName}: ${entry.detail ?? ''}`);
    }
  }
}

/**
 * Runs one step and always resolves to a StepResult, never rejects —
 * a tool that throws instead of returning a failed result (a bug in
 * that tool, or an unexpected error like getPlatformLauncher()
 * throwing on an unsupported OS) must only fail *that* step, not abort
 * the whole restore and discard every result already collected from
 * steps that already succeeded.
 */
async function runStep(
  step: WorkspaceConfig['steps'][number],
  workspaceId: string,
  liveResourceKeys?: ReadonlySet<string>,
): Promise<StepResult> {
  const tool = getTool(step.type);
  if (!tool) {
    return {
      success: false,
      message: `No registered tool for step type "${step.type}".`,
      durationMs: 0,
      code: ERROR_CODES.TOOL_NOT_FOUND.code,
    };
  }

  const startedAt = Date.now();

  try {
    const validation = tool.validate(step.params);
    if (!validation.valid) {
      return {
        success: false,
        message: formatInvalidParamsError(step.type, validation.errors),
        durationMs: 0,
        code: ERROR_CODES.INVALID_STEP_PARAMS.code,
      };
    }

    // Bounds worst-case restore time so one hung step can't stall the
    // whole thing forever — see step-timing-history.ts for how the
    // actual timeout value adapts from a generous default to this
    // tool's own real historical durations.
    // validation.data is type-erased to `unknown` here (this function is
    // generic across every tool type), but every tool's Zod schema
    // always parses to a real object — safe to treat as a plain record
    // for the timing-history key lookup (only Docker's `engine` field is
    // ever actually read from it there).
    const timeoutMs = getStepTimeoutMs(step.type, validation.data as Record<string, unknown>);
    // validation.data, not the raw step.params: this is zod's own
    // parsed-and-defaulted output, so a tool's run() never has to
    // re-guess whether an optional/defaulted field survived a config
    // saved before that field existed (see each tool's own detail on
    // why they still keep a defensive guard anyway).
    const result = await withTimeout(
      tool.run(validation.data, {
        workspaceId,
        ...(liveResourceKeys ? { liveResourceKeys } : {}),
      }),
      timeoutMs,
    );
    const durationMs =
      // Trust the tool's own reported duration unless it didn't set one
      // — a plain `||` here would wrongly override a real 0ms result,
      // since 0 is falsy.
      typeof result.durationMs === 'number' ? result.durationMs : Date.now() - startedAt;

    // A run that skipped resources already open did less than a real
    // open: its (much shorter) duration would drag the adaptive timeout
    // below what a real open needs — a 65ms "reused" terminal run made
    // the next real 4s open time out at 5s.
    const reusedSome = liveResourceKeys !== undefined && liveResourceKeys.size > 0;
    if (result.success && !reusedSome) {
      // macOS only, and only for the step types that map to a real app
      // name (tool-identity.ts) — measures real app-launch time on top
      // of this instant-return durationMs, by polling for the app to
      // actually come up (process-control.ts's waitForAppRunning).
      // Deliberately detached: it never awaits here, so it can never
      // slow down this step or any step after it in the restore
      // sequence — the measurement is a pure bonus for a *future*
      // display read (workspace-display.ts), not something this run
      // needs. Falls back to the plain durationMs (recorded exactly
      // once, either here or in the else branch below, never both) if
      // the app never shows up within waitForAppRunning's own generous
      // cap — a measurement miss is not a step failure.
      const appName =
        process.platform === 'darwin' ? getMacAppName(step.type, step.params) : undefined;
      if (appName) {
        void waitForAppRunning(appName)
          .then(({ detected, elapsedMs }) => {
            const measuredDurationMs = detected ? durationMs + elapsedMs : durationMs;
            recordSuccessfulStepDuration(
              step.type,
              validation.data as Record<string, unknown>,
              measuredDurationMs,
            );
          })
          .catch((err: unknown) => {
            console.error(
              `Failed to measure launch time for "${step.type}": ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      } else {
        // Best-effort only: recordSuccessfulStepDuration is a synchronous
        // electron-store write purely for future runs' adaptive timeouts
        // (step-timing-history.ts) — it must never turn a step that
        // actually succeeded into a reported failure just because the
        // timing sample couldn't be persisted (e.g. a corrupted store
        // file, a disk I/O error).
        try {
          recordSuccessfulStepDuration(
            step.type,
            validation.data as Record<string, unknown>,
            durationMs,
          );
        } catch (err) {
          console.error(
            `Failed to record step timing for "${step.type}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return { ...result, durationMs };
  } catch (err) {
    return {
      success: false,
      message: `Step "${step.type}" threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt,
      code: ERROR_CODES.STEP_FAILED.code,
    };
  }
}

/**
 * Races a promise against a timeout so a hung step can't stall the
 * whole restore forever. This only bounds how long we *wait* — it does
 * not cancel whatever the tool was actually doing (e.g. a still-
 * running shell command), since that would need an AbortController
 * threaded all the way through lib/shell-exec.ts. A timed-out step is
 * reported as a failure; the underlying operation may still finish (or
 * keep running) in the background.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
