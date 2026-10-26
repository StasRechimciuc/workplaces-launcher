/**
 * OS abstraction interface (docs/architecture.md #1). The rest of the
 * app — orchestrator, UI, config parser — calls this interface only,
 * never OS-specific code directly. macOS is the primary, actively-
 * worked implementation for now (claude.md's platform roadmap,
 * reversed 2026-10-21); Windows stays built and unit-tested but paused
 * until the founder's own daily machine switches to it, then Linux
 * slots in next (Phase 2) behind this same interface without touching
 * anything that depends on it.
 */
export interface PlatformResult {
  success: boolean;
  message: string;
  /** Optional, method-specific structured detail — today only
   * populated by openTerminal (a TerminalEntryResult, packages/shared),
   * and only on failure. Every other method here never sets this;
   * callers that care narrow it themselves for the one method that
   * does, same reasoning as StepResult.details' own doc comment. */
  detail?: Record<string, unknown>;
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
  /**
   * Opens a terminal window at `cwd`, running each of `commands` in
   * order, left running/interactive afterward. An empty `commands`
   * array still opens a terminal at `cwd` with nothing queued — a
   * real, supported case, not a degraded one (same precedent as
   * `openUrlInBrowserProfile`'s optional `url`).
   */
  openTerminal(cwd: string, commands: string[]): Promise<PlatformResult>;
  /**
   * Opens a file with the OS's default handler app for its type (the
   * "File or Link" step's no-`appPath`-override case). `path` must
   * already be an absolute, existing path — callers validate that
   * first (tools/link-tool.ts), this just performs the open.
   */
  openFileDefault(path: string): Promise<PlatformResult>;
  /**
   * Opens a URL with the system's default browser (the "File or Link"
   * step's no-`appPath`-override case for a link). Callers restrict
   * `url` to http/https before calling this — see link-tool.ts.
   */
  openUrlDefault(url: string): Promise<PlatformResult>;
}
