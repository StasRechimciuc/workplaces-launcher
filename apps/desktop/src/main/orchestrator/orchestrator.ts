import { basename } from 'node:path';
import type {
  CloseResult,
  LeftOpenEntry,
  RestoreProgressEvent,
  StepResult,
  SwitchResult,
  WorkspaceConfig,
} from '@workspace-launcher/shared';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { getTool } from '../tools/registry';
import { formatInvalidParamsError } from '../tools/validate-steps';
import { getStepTimeoutMs, recordSuccessfulStepDuration } from './step-timing-history';
import { getMacAppName, isExcludedFromAutoClose } from './tool-identity';
import { isAppRunning, quitApp, waitForAppRunning } from '../platform/macos/process-control';
import { isIntentActive, setIntentActive } from './workspace-activity-store';

export interface RunWorkspaceOptions {
  /** Optional live per-step signal — see restore-progress.ts's own doc
   * comment for why this is deliberately minimal. Electron-free by
   * design: this file stays platform-agnostic and independently
   * unit-testable, so the caller (handlers.ts) is what actually wires
   * this into an IPC push, not anything in here. */
  onStepProgress?: (event: RestoreProgressEvent) => void;
}

/**
 * Runs every step of a workspace config in order, via whatever tool
 * module is registered for its `type`. Sequencing details beyond plain
 * in-order execution — waiting on a prior step, per-step retry — are
 * Tier 1 feature work (docs/build-shell.md "Orchestrator logic"), not
 * boilerplate. This stub exists to prove the shape end-to-end: look up
 * each step's tool in the registry, validate its params, run it, and
 * fail loudly (never silently) when a tool type isn't registered or
 * params are invalid — per claude.md's no-silent-failure rule.
 */
export async function runWorkspace(
  config: WorkspaceConfig,
  options: RunWorkspaceOptions = {},
): Promise<StepResult[]> {
  // Restoring (via this function, whether directly or as Switch's own
  // open phase) is what "Active" means by definition — see
  // WCs/WC__workspace-activity.md's "intent AND liveness" rule. Set
  // unconditionally, regardless of per-step outcomes: liveness still
  // independently gates the DISPLAYED active state, so setting intent
  // here can never make a workspace show active unless something it
  // needs actually ends up running.
  setIntentActive(config.id, true);

  const results: StepResult[] = [];

  for (const [stepIndex, step] of config.steps.entries()) {
    options.onStepProgress?.({
      workspaceId: config.id,
      stepIndex,
      total: config.steps.length,
      status: 'running',
    });
    const result = await runStep(step, config.id);
    results.push(result);
    options.onStepProgress?.({
      workspaceId: config.id,
      stepIndex,
      total: config.steps.length,
      status: result.success ? 'success' : 'failure',
      message: result.message,
    });
  }

  return results;
}

/**
 * Re-runs exactly one step by index and returns its fresh result — the
 * orchestrator half of the Detail view's per-failed-step Retry button
 * (handlers.ts's retryWorkspaceStep/workspaces:retryStep). Deliberately
 * has no onStepProgress callback and no focus-session involvement the
 * way runWorkspace has: those exist to keep the user oriented through a
 * multi-step run, which a single retried step — only ever triggered
 * after the whole restore has already finished — doesn't need. Mirrors
 * runStep's own never-throws contract: an out-of-range index is
 * reported as a failed StepResult, not a thrown error, so every caller
 * can treat every outcome of a retry attempt uniformly.
 */
export async function retryStep(config: WorkspaceConfig, stepIndex: number): Promise<StepResult> {
  const step = config.steps[stepIndex];
  if (!step) {
    return {
      success: false,
      message: `No step at index ${stepIndex} (workspace has ${config.steps.length}).`,
      durationMs: 0,
      code: ERROR_CODES.RETRY_STEP_NOT_FOUND.code,
    };
  }
  return runStep(step, config.id);
}

/**
 * Every distinct macOS app name a config's steps map to (tool-identity.ts),
 * deduplicated — a config with two VS Code steps still contributes
 * "Visual Studio Code" once.
 */
function getConfigAppNames(config: WorkspaceConfig): string[] {
  const names = new Set<string>();
  for (const step of config.steps) {
    const name = getMacAppName(step.type, step.params);
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * Checks liveness for every distinct app name across every given
 * config in one batch (deduped, parallelized) — avoids re-checking the
 * same app name once per config/step when several workspaces share it.
 */
export async function buildRunningAppNameMap(
  configs: WorkspaceConfig[],
): Promise<Map<string, boolean>> {
  const distinctNames = new Set<string>();
  for (const config of configs) {
    for (const name of getConfigAppNames(config)) {
      distinctNames.add(name);
    }
  }
  const names = [...distinctNames];
  const liveness = await Promise.all(names.map((name) => isAppRunning(name)));
  return new Map(names.map((name, i) => [name, liveness[i]!]));
}

/** Every app name, across all given configs, that maps from a step
 * type excluded from auto-close (today: only 'chrome'). */
function getExcludedAppNames(configs: WorkspaceConfig[]): Set<string> {
  const names = new Set<string>();
  for (const config of configs) {
    for (const step of config.steps) {
      if (!isExcludedFromAutoClose(step.type)) continue;
      const name = getMacAppName(step.type, step.params);
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Active = this workspace was explicitly Restored/Switched-to and not
 * yet Closed (intent), AND something it needs is actually still
 * running (liveness). Liveness alone can only turn this false, never
 * true for a workspace nobody touched — see WCs/WC__workspace-activity.md
 * for why (a shared no-target tool like Spotify would otherwise show
 * every workspace that merely references it as falsely active).
 */
export function isConfigActive(
  config: WorkspaceConfig,
  runningAppNames: Map<string, boolean>,
): boolean {
  if (!isIntentActive(config.id)) return false;
  return getConfigAppNames(config).some((name) => runningAppNames.get(name) === true);
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
 * Full context change: closes whatever's running that another
 * currently-ACTIVE workspace opened (never just because some config
 * happens to mention a matching app name) and that this target doesn't
 * need, then runs the target's own steps unchanged. `open -a` is already
 * idempotent for anything already running, so the "open" half needs
 * no new logic at all.
 *
 * The "currently running" set is intentionally NOT "every app name in
 * every known config" — that would mean a real app you have open for
 * unrelated work gets closed just because an unrelated (possibly
 * never-restored) workspace's config happens to reference the same
 * app name. Only an app belonging to a workspace this app itself has
 * actually made active (intent + liveness) is ever a candidate.
 */
export async function switchToWorkspace(
  target: WorkspaceConfig,
  allConfigs: WorkspaceConfig[],
): Promise<SwitchResult> {
  const targetAppNames = new Set(getConfigAppNames(target));
  const runningAppNames = await buildRunningAppNameMap(allConfigs);
  const excludedAppNames = getExcludedAppNames(allConfigs);

  const candidateAppNames = new Set<string>();
  for (const other of allConfigs) {
    if (other.id === target.id) continue;
    if (!isConfigActive(other, runningAppNames)) continue;
    for (const name of getConfigAppNames(other)) {
      candidateAppNames.add(name);
    }
  }

  const closed: string[] = [];
  const leftOpen: LeftOpenEntry[] = [];
  const failedAppNames = new Set<string>();

  for (const [appName, running] of runningAppNames) {
    if (!running || targetAppNames.has(appName)) continue;
    if (!candidateAppNames.has(appName)) continue;
    if (excludedAppNames.has(appName)) {
      leftOpen.push({ appName, reason: 'excluded' });
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
  // inactive if something it needed failed to actually quit (app or
  // Docker); leave its intent untouched so liveness keeps reflecting
  // reality for it.
  for (const other of allConfigs) {
    if (other.id === target.id) continue;
    const hasUnresolvedFailure = getConfigAppNames(other).some((name) => failedAppNames.has(name));
    let dockerOk = true;
    // Intent alone, NOT isConfigActive — a Docker step has no macOS app
    // name (getMacAppName returns undefined for it), so a workspace
    // made up only of Docker steps can never satisfy isConfigActive's
    // liveness half regardless of whether its containers are actually
    // running. Intent (was this config explicitly Restored/Switched-to
    // and not yet Closed) is the correct, and only available, signal
    // for "does this config's own Docker teardown need to run."
    if (!hasUnresolvedFailure && isIntentActive(other.id)) {
      for (const step of other.steps) {
        const ok = await teardownDockerStepIfEnabled(step, closed, leftOpen);
        if (!ok) dockerOk = false;
      }
    }
    if (!hasUnresolvedFailure && dockerOk) {
      setIntentActive(other.id, false);
    }
  }

  // runWorkspace itself sets the target's own intent — no separate call
  // needed here.
  const stepResults = await runWorkspace(target);

  return { stepResults, closed, leftOpen };
}

/**
 * Closes only this workspace's own apps — never opens anything, never
 * touches another workspace. Skips anything excluded (Chrome) or still
 * needed by another currently-active workspace.
 */
export async function closeWorkspace(
  target: WorkspaceConfig,
  allConfigs: WorkspaceConfig[],
): Promise<CloseResult> {
  const others = allConfigs.filter((c) => c.id !== target.id);
  const runningAppNames = await buildRunningAppNameMap(allConfigs);

  const otherNeeds = new Set<string>();
  for (const other of others) {
    if (!isConfigActive(other, runningAppNames)) continue;
    for (const name of getConfigAppNames(other)) {
      otherNeeds.add(name);
    }
  }

  const closed: string[] = [];
  const leftOpen: LeftOpenEntry[] = [];
  let hadFailure = false;

  for (const step of target.steps) {
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
    if (otherNeeds.has(appName)) {
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
  // failed to actually quit — liveness would otherwise be overridden
  // by a false "not active" the next time it's checked.
  if (!hadFailure) {
    setIntentActive(target.id, false);
  }
  return { closed, leftOpen };
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
    const timeoutMs = getStepTimeoutMs(step.type);
    // validation.data, not the raw step.params: this is zod's own
    // parsed-and-defaulted output, so a tool's run() never has to
    // re-guess whether an optional/defaulted field survived a config
    // saved before that field existed (see each tool's own detail on
    // why they still keep a defensive guard anyway).
    const result = await withTimeout(tool.run(validation.data, { workspaceId }), timeoutMs);
    const durationMs =
      // Trust the tool's own reported duration unless it didn't set one
      // — a plain `||` here would wrongly override a real 0ms result,
      // since 0 is falsy.
      typeof result.durationMs === 'number' ? result.durationMs : Date.now() - startedAt;

    if (result.success) {
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
            recordSuccessfulStepDuration(step.type, measuredDurationMs);
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
          recordSuccessfulStepDuration(step.type, durationMs);
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
