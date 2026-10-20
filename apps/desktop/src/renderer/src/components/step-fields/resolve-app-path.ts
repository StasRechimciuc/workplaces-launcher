import type { AppCandidate } from '@workspace-launcher/shared';

/**
 * Classifies a detection result into exactly the three UI states
 * ResolvedAppPath.tsx renders — pulled into its own pure module so it
 * can be unit-tested without a DOM, same split this codebase already
 * uses for step-summaries.ts/launch-time-display.ts.
 */
export type AppPathClassification =
  | { kind: 'none' }
  | { kind: 'single'; candidate: AppCandidate }
  | { kind: 'multiple'; candidates: AppCandidate[] };

export function classifyAppPathCandidates(candidates: AppCandidate[]): AppPathClassification {
  if (candidates.length === 0) {
    return { kind: 'none' };
  }
  if (candidates.length === 1) {
    return { kind: 'single', candidate: candidates[0]! };
  }
  return { kind: 'multiple', candidates };
}
