/**
 * OS abstraction interface (docs/architecture.md #1). The rest of the
 * app — orchestrator, UI, config parser — calls this interface only,
 * never OS-specific code directly. macOS is the only real
 * implementation for v1; Windows/Linux implementations slot in later
 * (behind this same interface) without touching anything that depends
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
  /** Opens a URL in a specific browser, using a named browser profile. */
  openUrlInBrowserProfile(browser: string, profile: string, url: string): Promise<PlatformResult>;
}
