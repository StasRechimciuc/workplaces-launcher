import type { StepResult, WorkspaceConfig } from '@workspace-launcher/shared';
import { getTool } from '../tools/registry';

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
    const tool = getTool(step.type);
    if (!tool) {
      results.push({
        success: false,
        message: `No registered tool for step type "${step.type}".`,
        durationMs: 0,
      });
      continue;
    }

    const validation = tool.validate(step.params);
    if (!validation.valid) {
      results.push({
        success: false,
        message: `Invalid params for step type "${step.type}": ${validation.errors.join(', ')}`,
        durationMs: 0,
      });
      continue;
    }

    const startedAt = Date.now();
    const result = await tool.run(step.params, { workspaceId: config.id });
    results.push({
      ...result,
      durationMs: result.durationMs || Date.now() - startedAt,
    });
  }

  return results;
}
