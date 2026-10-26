/**
 * Which of a project directory's Docker Compose / Tilt files were
 * found — drives auto-selecting the Compose/Tilt engine toggle in
 * docker-fields.tsx. `composeFile` mirrors `docker compose`'s own real
 * discovery priority (compose.yaml > compose.yml > docker-compose.yaml
 * > docker-compose.yml) — picking among Compose's OWN candidates this
 * way isn't a guess, it's exactly what `docker compose` would pick
 * anyway with no `-f` given. The one real ambiguity this type
 * deliberately leaves for the caller to decide, never silently
 * resolving it: both a compose file AND a Tiltfile present.
 */
export interface ProjectFilesDetection {
  composeFile?: string;
  hasTiltfile: boolean;
}

export type DetectProjectFilesResult =
  ({ success: true } & ProjectFilesDetection) | { success: false; error: string; code: string };
