import type { TimingDisplay } from '../../../preload';

/**
 * Workspace-level pill text. Only 'full' gets the "to launch" suffix
 * appended — 'no-steps' already says there's nothing to time (its own
 * tooltip disavows a launch entirely, so appending "to launch" would
 * contradict it), and 'unmeasured'/'partial' are already full sentences
 * in `display`, where a suffix would read as broken grammar ("Not yet
 * measured to launch").
 */
export function workspaceLaunchTimeLabel(timing: TimingDisplay): string {
  switch (timing.state) {
    case 'full':
      return `${timing.display} to launch`;
    case 'no-steps':
    case 'unmeasured':
    case 'partial':
      return timing.display;
  }
}

export function workspaceLaunchTimeTooltip(timing: TimingDisplay): string {
  switch (timing.state) {
    case 'no-steps':
      return "This workspace has no steps, so there's nothing to time.";
    case 'unmeasured':
      return 'Not enough run history yet — launch this workspace a few times and an estimated launch time will show up here.';
    case 'partial':
      return "Estimated from only the steps with enough run history so far — the real total will be higher once every step has history. It's approximate, and some apps may still be finishing their own startup after this point.";
    case 'full':
      return "Estimated launch time, based on your past runs of this workspace. It's approximate, and some apps may still be finishing their own startup after this point.";
  }
}

/**
 * Per-step badge text — mirrors workspaceLaunchTimeLabel's "to launch"
 * suffix convention (only on 'full') so the two sibling timing
 * displays stay symmetric (same concept, same phrasing) instead of
 * drifting if one's suffix logic changes without the other.
 */
export function stepLaunchTimeLabel(timing: TimingDisplay): string {
  switch (timing.state) {
    case 'full':
      return `${timing.display} to launch`;
    case 'no-steps':
    case 'unmeasured':
    case 'partial':
      return timing.display;
  }
}

export function stepLaunchTimeTooltip(timing: TimingDisplay): string {
  if (timing.state === 'unmeasured') {
    return 'Launch time not measured yet — launch this workspace a few times to start recording it.';
  }
  // 'full' in practice for a single step; 'no-steps'/'partial' are
  // workspace-level-only outcomes, handled defensively since the type
  // is shared.
  return `Launch time: ${timing.display}`;
}
