import { z } from 'zod';
import type { StepResult, ToolPlugin, ValidationResult } from '@workspace-launcher/shared';
import { getPlatformLauncher } from '../platform';

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
});

export type SpotifyStepParams = z.infer<typeof SpotifyStepParamsSchema>;

const SPOTIFY_APP_NAME = 'Spotify';

export const spotifyTool: ToolPlugin<SpotifyStepParams> = {
  type: 'spotify',

  validate(params: unknown): ValidationResult {
    const result = SpotifyStepParamsSchema.safeParse(params);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: result.error.issues.map((issue) => issue.message) };
  },

  async run(params: SpotifyStepParams): Promise<StepResult> {
    const startedAt = Date.now();
    const launcher = getPlatformLauncher();
    const playlist = params.playlist;

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
        ? await launcher.openInApp(SPOTIFY_APP_NAME, playlist)
        : await launcher.launchApp(SPOTIFY_APP_NAME);

    return { success: result.success, message: result.message, durationMs: Date.now() - startedAt };
  },

  async teardown(): Promise<StepResult> {
    // Tier 2 (docs/build-shell.md) — no-op for now.
    return { success: true, message: 'No teardown for Spotify steps yet.', durationMs: 0 };
  },
};
