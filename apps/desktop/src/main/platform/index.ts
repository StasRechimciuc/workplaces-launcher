import type { PlatformLauncher } from './types';
import { macosLauncher } from './macos/launcher';
import { windowsLauncher } from './windows/launcher';

export type { PlatformLauncher, PlatformResult } from './types';

/**
 * Detects the current OS and returns the correct PlatformLauncher
 * implementation. Windows is the v1 target (platform roadmap reordered
 * 2026-09-07 — see claude.md); Linux is next (Phase 2). The macOS
 * implementation is kept as-is and still dispatches correctly — paused,
 * not removed, pending Phase 3 (docs/architecture.md #1). Any other OS
 * fails loudly here rather than silently falling back to a no-op, per
 * claude.md's no-silent-failure rule. Adding Linux support means adding
 * a win32-style branch here plus a new platform/linux/launcher.ts;
 * nothing else changes.
 */
export function getPlatformLauncher(): PlatformLauncher {
  if (process.platform === 'win32') {
    return windowsLauncher;
  }
  if (process.platform === 'darwin') {
    return macosLauncher;
  }
  throw new Error(
    `Unsupported platform: "${process.platform}". Workspace Launcher v1 targets Windows; ` +
      'Linux support is next (Phase 2), macOS support is paused (Phase 3), not removed.',
  );
}
