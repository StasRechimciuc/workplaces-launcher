import { z } from 'zod';
import type {
  StepResult,
  StepDisplayRow,
  ToolPlugin,
  ValidationResult,
} from '@workspace-launcher/shared';
import { ERROR_CODES, SPOTIFY_APP_NAME, zodValidate } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';
import { resolveAppLaunchTarget } from './resolve-app-path';
import { appResourceFor } from '../resources/kinds/app-kind';

// A `spotify:` URI (e.g. "spotify:playlist:37i9dQZF1DWZeKCadgRdKQ") or an
// "https://open.spotify.com/..." link — the two link shapes Spotify's
// own Share menu produces. A friendly playlist *name* (e.g. "Deep
// Focus") is deliberately rejected: resolving a name to a real URI
// would need Spotify's OAuth Web API, explicitly out of scope here —
// accepting an arbitrary string would silently do nothing useful once
// handed to the platform launcher.
const SPOTIFY_LINK_PATTERN = /^(spotify:|https:\/\/open\.spotify\.com\/)/;

const SpotifyStepParamsSchema = z.object({
  playlist: z
    .string()
    .optional()
    .refine((value) => value === undefined || value === '' || SPOTIFY_LINK_PATTERN.test(value), {
      message:
        "playlist must be a spotify: URI or an https://open.spotify.com/ link (a bare playlist name can't be resolved without Spotify's own API)",
    }),
  // Display-only — the human-readable name of the playlist `playlist`
  // points to, captured once at picker-selection time (step-fields/
  // spotify-fields.tsx) so detail()/expand() and the edit modal can show
  // a real name instead of the raw URI without a live API call. run()
  // never reads this; only `playlist` (the real URI) drives the restore.
  playlistName: z.string().optional(),
  // The real, detected install path this step launches — see
  // vscode-tool.ts's identical `appPath` field for the full precedent/
  // reasoning.
  appPath: z.string().optional(),
});

export type SpotifyStepParams = z.infer<typeof SpotifyStepParamsSchema>;

export const spotifyTool: ToolPlugin<SpotifyStepParams> = {
  type: 'spotify',

  validate(params: unknown): ValidationResult<SpotifyStepParams> {
    return zodValidate(SpotifyStepParamsSchema, params);
  },

  async run(params: SpotifyStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const launcher = getPlatformLauncher();
    const playlist = params.playlist;

    const resolved = await resolveAppLaunchTarget('spotify', SPOTIFY_APP_NAME, params.appPath);
    if (!resolved.ok) {
      return {
        success: false,
        message: `${resolved.message} Spotify was not opened.`,
        durationMs: Date.now() - startedAt,
        code: ERROR_CODES.APP_PATH_NOT_FOUND.code,
      };
    }

    // openInApp passes `playlist` as a bare positional argv entry to
    // the resolved Spotify.exe (windows/launcher.ts) / `open -a` on
    // macOS — works today on macOS (verified: Spotify's own app
    // accepts a spotify: URI this way), but UNVERIFIED on Windows:
    // if the installed Spotify build only honors a spotify: URI via
    // its registered `spotify:` protocol handler rather than a plain
    // launch argument, `runDetached` would still report success (it
    // only confirms the process spawned, see shell-exec.ts) while
    // Spotify silently opens with no playlist — a false-positive step
    // result, currently untestable, same as this project's other
    // Windows-VM-blocked gaps (see WCs/WC__project-status.md).
    const result =
      playlist !== undefined && playlist.length > 0
        ? await launcher.openInApp(resolved.target, playlist)
        : await launcher.launchApp(resolved.target);

    return {
      success: result.success,
      message: result.message,
      durationMs: Date.now() - startedAt,
      ...(result.success ? {} : { code: ERROR_CODES.APP_LAUNCH_FAILED.code }),
    };
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for Spotify steps yet.', durationMs: 0 };
  },

  // The same app run() resolves — tracked as an app resource, so Close
  // quits Spotify only if this app opened it and nothing else uses it.
  async resources(params) {
    const resolved = await resolveAppLaunchTarget('spotify', SPOTIFY_APP_NAME, params.appPath);
    return resolved.ok ? appResourceFor(resolved.target, 'Spotify') : [];
  },

  // Raw-params contract (ToolPlugin.detail/expand's own doc comment) —
  // relocated verbatim from config/workspace-display.ts's old
  // detailForStep/expandForStep 'spotify' branches, not new logic.
  detail(params) {
    const playlist =
      typeof params['playlist'] === 'string' && params['playlist'].length > 0
        ? params['playlist']
        : undefined;
    const playlistName =
      typeof params['playlistName'] === 'string' && params['playlistName'].length > 0
        ? params['playlistName']
        : undefined;
    if (!playlist) {
      return 'Opens Spotify.';
    }
    // Prefers the human name (quoted, since it's a readable title);
    // falls back to the raw URI, unquoted, for a config saved before
    // playlistName existed, or one hand-edited/imported without it.
    return playlistName ? `Opens "${playlistName}" in Spotify.` : `Opens ${playlist} in Spotify.`;
  },

  expand(params): StepDisplayRow[] | undefined {
    const playlist =
      typeof params['playlist'] === 'string' && params['playlist'].length > 0
        ? params['playlist']
        : undefined;
    const playlistName =
      typeof params['playlistName'] === 'string' && params['playlistName'].length > 0
        ? params['playlistName']
        : undefined;
    return playlist
      ? [{ i: 'music', label: 'Playlist', mono: playlistName ?? playlist }]
      : undefined;
  },
};
