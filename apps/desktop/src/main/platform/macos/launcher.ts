import type { PlatformLauncher } from '../types';

/**
 * macOS implementation of PlatformLauncher, via `open -a` / AppleScript
 * (`osascript`) — docs/architecture.md #1. Method bodies are
 * intentionally unimplemented: wiring up the actual `open -a` /
 * osascript calls (through ../../lib/shell-exec.ts) is Tier 1 feature
 * work (docs/build-shell.md), not boilerplate. Each throws rather than
 * silently no-op'ing, per claude.md's no-silent-failure rule — a caller
 * invoking one of these today gets a loud, unambiguous error, not a
 * step that "succeeds" without doing anything.
 */
export const macosLauncher: PlatformLauncher = {
  async launchApp(_appName) {
    throw new Error('Not implemented: macosLauncher.launchApp');
  },
  async openInApp(_appName, _targetPath) {
    throw new Error('Not implemented: macosLauncher.openInApp');
  },
  async openUrlInBrowserProfile(_browser, _profile, _url) {
    throw new Error('Not implemented: macosLauncher.openUrlInBrowserProfile');
  },
};
