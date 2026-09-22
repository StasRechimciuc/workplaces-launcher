/**
 * OS abstraction interface (docs/architecture.md #1). The rest of the
 * app — orchestrator, UI, config parser — calls this interface only,
 * never OS-specific code directly. Windows is the real, v1-target
 * implementation (claude.md's platform roadmap: Windows v1 -> Linux ->
 * macOS); the existing macOS implementation is kept working as interim
 * filler work while Windows VM access is unavailable (see claude.md's
 * 2026-09-17 note), not as the v1 target. Linux slots in next (Phase
 * 2) behind this same interface without touching anything that depends
 * on it.
 */
export interface PlatformResult {
  success: boolean;
  message: string;
}

export interface PlatformLauncher {
  /** Launches a native app by name (e.g. "Spotify", "Slack"). */
  launchApp(appName: string): Promise<PlatformResult>;
  /** Opens a folder path in a specific app (e.g. VS Code). */
  openInApp(appName: string, targetPath: string): Promise<PlatformResult>;
  /**
   * Opens a URL in a specific browser, using a named browser profile.
   * `url` is optional — a profile-only launch (open the browser window
   * for this profile, no specific tab to open) is a real, supported
   * case, not a degraded one.
   */
  openUrlInBrowserProfile(browser: string, profile: string, url?: string): Promise<PlatformResult>;
}
