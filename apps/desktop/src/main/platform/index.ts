import type { PlatformLauncher } from './types';
import { macosLauncher } from './macos/launcher';

export type { PlatformLauncher, PlatformResult } from './types';

/**
 * Detects the current OS and returns the correct PlatformLauncher
 * implementation. macOS is the only implementation for v1
 * (docs/architecture.md #1) — any other OS fails loudly here rather
 * than silently falling back to a no-op, per claude.md's
 * no-silent-failure rule. When Windows/Linux support is built, this is
 * the only function that changes.
 */
export function getPlatformLauncher(): PlatformLauncher {
  if (process.platform === 'darwin') {
    return macosLauncher;
  }
  throw new Error(
    `Unsupported platform: "${process.platform}". Workspace Launcher v1 is macOS-only.`,
  );
}
