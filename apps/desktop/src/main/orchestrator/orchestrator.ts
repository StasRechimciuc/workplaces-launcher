import type { StepResult, WorkspaceConfig } from '@workspace-launcher/shared';
import { getTool } from '../tools/registry';
import { formatInvalidParamsError } from '../tools/validate-steps';
import { getStepTimeoutMs, recordSuccessfulStepDuration } from './step-timing-history';

/**
 * Runs every step of a workspace config in order, via whatever tool
 * module is registered for its `type`. Sequencing details beyond plain
 * in-order execution — waiting on a prior step, per-step retry, live
 * status updates to the UI — are Tier 1 feature work (docs/build-
 * shell.md "Orchestrator logic"), not boilerplate. This stub exists to
 * prove the shape end-to-end: look up each step's tool in the registry,
 * validate its params, run it, and fail loudly (never silently) when a
 * tool type isn't registered or params are invalid — per claude.md's
 * no-silent-failure rule.
 */
export async function runWorkspace(config: WorkspaceConfig): Promise<StepResult[]> {
  const results: StepResult[] = [];

  for (const step of config.steps) {
    results.push(await runStep(step, config.id));
  }

  return results;
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

    return { ...result, durationMs };
  } catch (err) {
    return {
      success: false,
      message: `Step "${step.type}" threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt,
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
