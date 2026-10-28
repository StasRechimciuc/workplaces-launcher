// See the identical note in ../orchestrator/step-timing-history.ts —
// electron-store is pinned to ^8.x because v9+ is pure ESM and this
// main process bundle builds as CommonJS.
import Store from 'electron-store';

export interface AppSettings {
  defaultTerminalApp: string;
  launchOnLogin: boolean;
  /** Whether the one-time "still running in the menu bar" notice has
   * already been shown — see main/index.ts's window-all-closed
   * handler. Shown at most once, ever, not once per launch. */
  hasShownBackgroundNotice: boolean;
  /** Whether the first-launch Accessibility explanation has been
   * completed or skipped ("Continue without") — see
   * AccessibilityStatus in @workspace-launcher/shared. Never reset: a
   * later revoke is handled by the banner and Settings row, not by
   * forcing the modal again. */
  hasCompletedAccessibilityOnboarding: boolean;
}

const defaults: AppSettings = {
  defaultTerminalApp: 'Terminal',
  launchOnLogin: false,
  hasShownBackgroundNotice: false,
  hasCompletedAccessibilityOnboarding: false,
};

/**
 * Persisted app-level settings — distinct from workspace configs (see
 * src/main/config/loader.ts). electron-store handles the correct
 * cross-platform userData location and JSON read/write for us, so this
 * file only needs to declare the settings shape and its defaults.
 */
export const settingsStore = new Store<AppSettings>({ defaults });
