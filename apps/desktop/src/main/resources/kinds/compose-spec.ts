import { basename, normalize } from 'node:path';
import type { ResourceSpec } from '@workspace-launcher/shared';
import { expandHome } from '../../lib/paths';

/**
 * The Compose resource spec (see compose-kind.ts), kept apart from the
 * kind itself so docker-tool.ts can declare its resources without an
 * import cycle — the kind depends on docker-tool.ts's daemon check and
 * command runner.
 */

export const COMPOSE_KIND = 'compose';

/**
 * The spec for a Compose step: its directory (expanded and lexically
 * normalized, so `~/app` and `/Users/me/app/` are the same stack) plus
 * how to stop it.
 */
export function composeResource(
  directory: string,
  downCommand: string,
  stopOnClose: boolean,
): ResourceSpec {
  const normalized = normalizeDirectory(expandHome(directory));
  return {
    kind: COMPOSE_KIND,
    identity: { directory: normalized },
    label: `Docker (${basename(normalized)})`,
    options: { downCommand, stopOnClose },
  };
}

/** Lexical only — never realpath'd, so a symlinked path stays its own identity. */
export function normalizeDirectory(directory: string): string {
  const normalized = normalize(directory);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}
