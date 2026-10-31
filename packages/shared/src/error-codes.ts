/**
 * Netflix-style error codes: every user-facing failure gets a short,
 * stable code (`ER-<CATEGORY>-<NN>`) alongside its free-text message.
 * The code is what a "Learn more about this error" link
 * (ErrorCode.tsx) resolves via the Errors page (ErrorsModal.tsx) — a
 * static, searchable catalog, not a log of past occurrences.
 *
 * Codes are assigned per *category* of failure, not per throw site —
 * every call site that produces the same user-facing situation reuses
 * the same code. Throw/construct sites reference `ERROR_CODES.X.code`
 * rather than retyping the string, so a typo or a renamed/removed code
 * is a compile error, not something a separate cross-reference test
 * has to catch.
 */
export interface ErrorCodeDefinition {
  readonly code: string;
  readonly title: string;
  readonly explanation: string;
  /**
   * Short, plain-language, non-technical summary shown inline wherever
   * this code's StepResult/error message would otherwise be — when
   * present, ErrorCode.tsx shows this instead of the raw per-instance
   * message, demoting that raw text to a collapsed "Show technical
   * detail" toggle on the same row. Absent means this code hasn't been
   * converted yet (a staged rollout, not every code at once — see
   * error-codes.ts's own module doc) — ErrorCode.tsx falls back to
   * showing the raw message directly, exactly as before this field
   * existed. Written for a user who is NOT currently debugging, just
   * trying to get back to work — name the problem plus the one
   * dominant fix where there is one; omit a confident fix here (leave
   * `fixSteps` out too) when the real cause genuinely varies per
   * instance, rather than guessing.
   */
  readonly headline?: string;
  /**
   * Optional, static, per-code fix steps shown in the Errors catalog
   * (ErrorsModal.tsx) alongside `explanation` — only for codes with a
   * small number of concrete, almost-always-applicable actions. Most
   * codes won't have this: a numbered list is overkill for anything
   * that doesn't genuinely have multiple distinct steps, and wrong/
   * misleading for a code whose real cause varies per instance (e.g.
   * DOCKER_STEP_FAILED's underlying command failure).
   */
  readonly fixSteps?: readonly string[];
  /**
   * Marks this code as "not really a failure, nothing to act on" —
   * e.g. a step type with no registered tool plugin yet. Checked
   * generically by the UI (ErrorCode.tsx/RestoreResults.tsx) to decide
   * whether to show the muted/dashed "skipped" treatment instead of a
   * real failure's red one — a catalog-level flag rather than a
   * hardcoded `code === X` check at the render site, so a future code
   * that also deserves this treatment (a disabled step, an
   * unimplemented-on-this-platform step) only needs to set this flag,
   * not a render-code change too. `'skipped'` is the only value today;
   * left as a union of one rather than a boolean so a second, visually
   * distinct non-failure treatment could be added later without
   * reshaping this field.
   */
  readonly treatment?: 'skipped';
}

export const ERROR_CODES = {
  TOOL_NOT_FOUND: {
    code: 'ER-TOOL-01',
    title: 'Unknown step type',
    headline: "This step type isn't supported in this version of Workspace Launcher.",
    fixSteps: ['Remove or replace this step in the workspace'],
    treatment: 'skipped',
    explanation:
      "This step's tool type isn't recognized by this version of Workspace Launcher. This usually happens if the workspace file was created by a newer version, or edited by hand.",
  },
  INVALID_STEP_PARAMS: {
    code: 'ER-TOOL-02',
    title: 'Invalid step settings',
    explanation:
      "This step's saved settings don't match what that tool type expects — for example a missing or malformed field. This can happen if the workspace file was edited by hand or came from an incompatible version.",
  },
  STEP_FAILED: {
    code: 'ER-TOOL-03',
    title: 'Step failed unexpectedly',
    explanation:
      'This step ran but hit an unexpected error, or took too long to finish and was stopped. The message shown alongside this code has the specific detail.',
  },
  RETRY_STEP_NOT_FOUND: {
    code: 'ER-TOOL-04',
    title: 'Step no longer exists',
    explanation:
      "A retry was requested for a step that's no longer part of this workspace — it may have been removed since the restore ran.",
  },
  VSCODE_TERMINAL_RESTORE_FAILED: {
    code: 'ER-VSC-01',
    title: "Couldn't restore VS Code terminals",
    headline: "VS Code opened, but its terminals couldn't be restored automatically.",
    fixSteps: ['Make sure the Workspace Launcher VS Code extension is installed and enabled'],
    explanation:
      'VS Code opened, but Workspace Launcher could not hand off the saved terminal commands to the companion extension. Make sure the Workspace Launcher VS Code extension is installed and enabled.',
  },
  APP_LAUNCH_FAILED: {
    code: 'ER-LAUNCH-01',
    title: "Couldn't open the app",
    headline: "This step's app couldn't be opened.",
    fixSteps: [
      'Make sure the app is still installed',
      'Try opening it manually, then restore again',
    ],
    explanation:
      'The app for this step could not be launched. It may have been moved, renamed, or uninstalled since this workspace was set up.',
  },
  APP_PATH_NOT_FOUND: {
    code: 'ER-LAUNCH-02',
    title: 'Configured app location not found',
    headline: "This step's saved app location no longer works.",
    fixSteps: ['Re-open this step and locate the app again'],
    explanation:
      "This step's configured app location no longer exists — the app may have moved or been uninstalled since it was chosen. Re-open this step to locate it again.",
  },
  APP_DETECTION_FAILED: {
    code: 'ER-LAUNCH-03',
    title: "Couldn't detect installed apps",
    explanation:
      "Workspace Launcher couldn't scan this machine's Applications folders to find this app. It may be a permissions issue reading /Applications.",
  },
  PROJECT_FILES_DETECTION_FAILED: {
    code: 'ER-DOCKER-03',
    title: "Couldn't check this folder",
    explanation:
      "Workspace Launcher couldn't check this directory for a Compose file or Tiltfile. It may be a permissions issue, or the folder may no longer exist.",
  },
  CHROME_TABS_FAILED: {
    code: 'ER-CHROME-01',
    title: "Couldn't open one or more Chrome tabs",
    headline: 'Chrome opened, but one or more saved tabs failed to load.',
    explanation: 'Chrome opened, but one or more of the saved URLs for this step failed to load.',
  },
  CHROME_PROFILES_UNAVAILABLE: {
    code: 'ER-CHROME-02',
    title: 'Chrome profile unavailable',
    headline: "This step's Chrome profile isn't available.",
    fixSteps: [
      'Check that the profile still exists in Chrome',
      'Pick a different profile for this step',
    ],
    explanation:
      "Workspace Launcher couldn't read Chrome's installed profiles. Chrome may not be installed, or its profile data couldn't be read.",
  },
  WORKSPACE_INVALID: {
    code: 'ER-CFG-01',
    title: 'Invalid workspace configuration',
    // headline is deliberately short and generic, never restating the
    // specific field message — when a save failure has fieldErrors, the
    // broken row is already auto-expanded with the exact message shown
    // directly under the offending field, so repeating it here too
    // (behind the "technical detail" toggle this headline enables) was
    // confirmed pure duplication in real use: the same "Down command
    // must not include -v/--volumes..." text shown twice, once inline,
    // once in this banner. Callers suppress the toggle entirely via
    // ErrorCode's hideTechnicalDetail when fieldErrors exist; it's kept
    // available for the rarer case where a save fails with no specific
    // field to point at (a whole-object check with no field path).
    headline: "This workspace couldn't be saved.",
    explanation:
      "This workspace couldn't be saved because one or more of its steps have invalid settings.",
  },
  WORKSPACE_NAME_TAKEN: {
    code: 'ER-CFG-04',
    title: 'Workspace name already used',
    headline: 'Another workspace already has this name.',
    explanation:
      "Every workspace needs its own name — its browser window is named after it, and that name is how the app tells its window apart from the others. Choose a name no other workspace uses (capitalization doesn't count as different).",
  },
  WORKSPACE_NOT_FOUND: {
    code: 'ER-CFG-03',
    title: 'Workspace not found',
    explanation:
      'This workspace no longer exists — it may have been deleted, possibly from another window.',
  },
  SPOTIFY_REAUTH_REQUIRED: {
    code: 'ER-SPOTIFY-01',
    title: 'Spotify needs reconnecting',
    explanation:
      'Your Spotify connection has expired and needs to be reconnected before its playlists can be loaded.',
  },
  SPOTIFY_PLAYLISTS_FAILED: {
    code: 'ER-SPOTIFY-02',
    title: "Couldn't load Spotify playlists",
    explanation: 'Workspace Launcher was unable to fetch your Spotify playlists.',
  },
  SPOTIFY_CONNECT_FAILED: {
    code: 'ER-SPOTIFY-03',
    title: "Couldn't connect to Spotify",
    explanation:
      "Workspace Launcher wasn't able to complete the Spotify connection — the authorization may have been denied, cancelled, or interrupted. Try connecting again.",
  },
  LINK_TARGET_NOT_FOUND: {
    code: 'ER-LINK-01',
    title: "Couldn't find the file",
    explanation:
      "This step's configured file no longer exists at its saved location — it may have been moved, renamed, or deleted since this workspace was set up.",
  },
  LINK_OPEN_FAILED: {
    code: 'ER-LINK-02',
    title: "Couldn't open the file or link",
    explanation:
      'The file or link could not be opened — there may be no app installed that can handle it, or the chosen app (if one was set) could not be launched.',
  },
  DOCKER_DAEMON_DOWN: {
    code: 'ER-DOCKER-01',
    title: "Docker isn't running",
    // Deliberately no single dominant fix here (and so no fixSteps) —
    // this one code covers several real sub-cases with different right
    // actions (not installed vs. couldn't be launched vs. didn't finish
    // starting in time vs. stopping a workspace, which never tries to
    // launch Docker at all) — see docker-tool.ts's ensureDockerDaemon-
    // Running. The per-instance technical detail (behind "Show
    // technical detail" on the step) already states which one applies
    // and what to do about it; this headline stays honest and generic
    // rather than guessing a fix that might be wrong for this instance.
    headline: "Docker isn't running.",
    explanation:
      "This step needs Docker's daemon running. On restore, Workspace Launcher tries to start Docker Desktop automatically and waits up to 90 seconds for it — this only shows once that didn't work (Docker isn't installed, couldn't be launched, or didn't finish starting in time). Expand \"Show technical detail\" on the step for the specific reason. Stopping a workspace never tries to start Docker for you, since there would be nothing left to stop.",
  },
  DOCKER_STEP_FAILED: {
    code: 'ER-DOCKER-02',
    title: 'Docker Compose command failed',
    // Compose-engine only — the Tilt engine hands its commands to a
    // real terminal via the exact same openTerminal mechanism the
    // Terminal step uses, so a Tilt-branch failure uses
    // TERMINAL_START_FAILED/TERMINAL_COMMAND_FAILED below instead of
    // this code, same as the Terminal step itself (reuse, not a
    // parallel Docker-specific pair of codes for an identical
    // mechanism). No generic fixSteps — the real cause is whatever the
    // user's own compose file/command does.
    headline: "This step's Docker Compose command didn't finish successfully.",
    explanation:
      'This step\'s configured Compose command didn\'t finish successfully. Expand "Show technical detail" on the step for the exact output from your command.',
  },
  TERMINAL_START_FAILED: {
    code: 'ER-TERM-01',
    title: "Terminal didn't start",
    // Covers two real sub-cases that both mean "nothing configured for
    // this entry ever got a chance to run": the terminal app itself
    // failing to launch, and its generated script's own `cd` into the
    // configured directory failing. Both get the same muted "not run"
    // treatment in the UI and share this one code (their fixes are
    // close enough — check the terminal app vs. check the directory —
    // that the per-instance detail, not a code split, carries the
    // difference); a command that actually ran and failed is a
    // genuinely different situation with different fix advice, so that
    // gets its own code (TERMINAL_COMMAND_FAILED) instead of being
    // merged in here too. Also used by Docker's Tilt engine, which
    // reuses this exact mechanism (openTerminal) — not just the plain
    // Terminal step.
    headline: "A terminal for this step didn't start.",
    explanation:
      "This step hands a command to a real terminal window, and that terminal never got far enough to run it. The two real causes: the terminal app itself couldn't be launched (rare — check it's actually installed), or it opened but couldn't change into the configured directory, usually because that folder was moved, renamed, deleted, or lives on a drive that isn't currently mounted. The step's own row shows which one happened and the exact path it tried.",
  },
  TERMINAL_COMMAND_FAILED: {
    code: 'ER-TERM-02',
    title: 'A command failed in the terminal',
    // Distinct from TERMINAL_START_FAILED above: the terminal DID open
    // and the command DID run — it just exited with a nonzero code. No
    // generic fixSteps — same reasoning as DOCKER_STEP_FAILED, the real
    // cause is whatever that specific command does. Also used by
    // Docker's Tilt engine (see TERMINAL_START_FAILED's own note).
    headline: "This step's terminal opened, but a command inside it failed.",
    explanation:
      "A command configured for this step's terminal ran and exited with a failure — the terminal and the command itself were both fine up to that point. Common causes: a typo in the command, a tool it depends on isn't installed or isn't on PATH, a port it needs is already in use by something else, or a config file it expects (a compose file, a Tiltfile) is missing from that directory. The step's own row shows the exact command, exit code, and captured output.",
  },
  HOTKEY_INVALID: {
    code: 'ER-HOTKEY-01',
    title: 'Invalid shortcut',
    explanation:
      "This shortcut isn't a combination Workspace Launcher can register with the operating system. Try a different key combination.",
  },
  HOTKEY_ALREADY_IN_USE: {
    code: 'ER-HOTKEY-02',
    title: 'Shortcut unavailable',
    explanation:
      "This shortcut (or its Shift variant, used for Switch) is already claimed by another app or by macOS itself. There's no way for Workspace Launcher to know which one — try a different key combination.",
  },
  ACCESSIBILITY_NOT_GRANTED: {
    code: 'ER-PERM-01',
    title: 'Accessibility access is off',
    headline: "Workspace Launcher doesn't have Accessibility access yet.",
    fixSteps: [
      'Open System Settings → Privacy & Security → Accessibility',
      'Turn on Workspace Launcher (if it isn’t listed, add it with the + button)',
    ],
    explanation:
      "Workspace Launcher uses macOS Accessibility to find, focus and close exactly the windows each workspace opened — and nothing else. Without it, the app runs in a reduced mode: restoring still works, but closing and switching workspaces work per app, not per window. It's one switch that covers every app; Workspace Launcher never asks for per-app Automation access.",
  },
  WINDOW_HELPER_UNAVAILABLE: {
    code: 'ER-SYS-03',
    title: 'Window helper unavailable',
    // Not a permission problem — granting Accessibility wouldn't help,
    // so this is kept apart from ACCESSIBILITY_NOT_GRANTED rather than
    // folded into it. A packaged build can't ship without the helper
    // (package:mac fails), so in practice this means a damaged install
    // or a dev build where `npm run build:helper` hasn't been run.
    headline: "Workspace Launcher's window helper couldn't start.",
    fixSteps: ['Reinstall Workspace Launcher'],
    explanation:
      "Workspace Launcher includes a small native helper (wl-helper) for working with windows. It's missing or failed to run, so the app is in a reduced mode: restoring still works, but closing and switching workspaces work per app, not per window. The technical detail shows what went wrong.",
  },
  LAUNCH_ON_LOGIN_FAILED: {
    code: 'ER-SYS-02',
    title: "Couldn't update launch-at-login",
    explanation:
      'Workspace Launcher was unable to change its login-item registration with the operating system.',
  },
  SYSTEM_UNEXPECTED: {
    code: 'ER-SYS-01',
    title: 'Something went wrong',
    explanation:
      "An unexpected internal error occurred. If this keeps happening, note this code when reporting it — it's useful even though it doesn't point to one specific cause.",
  },
} as const satisfies Record<string, ErrorCodeDefinition>;

export const ERROR_CODES_LIST: readonly ErrorCodeDefinition[] = Object.values(ERROR_CODES);

const ERROR_CODES_BY_CODE: ReadonlyMap<string, ErrorCodeDefinition> = new Map(
  ERROR_CODES_LIST.map((def) => [def.code, def]),
);

/**
 * Returns undefined for a code not in the catalog — callers must
 * handle that gracefully (never throw), since a code may have been
 * serialized by an older/newer build than the one resolving it.
 */
export function getErrorCode(code: string): ErrorCodeDefinition | undefined {
  return ERROR_CODES_BY_CODE.get(code);
}
