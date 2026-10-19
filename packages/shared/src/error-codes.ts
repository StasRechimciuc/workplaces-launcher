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
}

export const ERROR_CODES = {
  TOOL_NOT_FOUND: {
    code: 'ER-TOOL-01',
    title: 'Unknown step type',
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
    explanation:
      'VS Code opened, but Workspace Launcher could not hand off the saved terminal commands to the companion extension. Make sure the Workspace Launcher VS Code extension is installed and enabled.',
  },
  APP_LAUNCH_FAILED: {
    code: 'ER-LAUNCH-01',
    title: "Couldn't open the app",
    explanation:
      'The app for this step could not be launched. It may have been moved, renamed, or uninstalled since this workspace was set up.',
  },
  CHROME_TABS_FAILED: {
    code: 'ER-CHROME-01',
    title: "Couldn't open one or more Chrome tabs",
    explanation:
      'Chrome opened, but one or more of the saved URLs for this step failed to load.',
  },
  CHROME_PROFILES_UNAVAILABLE: {
    code: 'ER-CHROME-02',
    title: 'Chrome profile unavailable',
    explanation:
      "Workspace Launcher couldn't read Chrome's installed profiles. Chrome may not be installed, or its profile data couldn't be read.",
  },
  WORKSPACE_INVALID: {
    code: 'ER-CFG-01',
    title: 'Invalid workspace configuration',
    explanation:
      "This workspace couldn't be saved because one or more of its steps have invalid settings.",
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
