import type { ResourceSpec } from '@workspace-launcher/shared';
import { basename } from 'node:path';
import { expandHome } from '../../lib/paths';
import { terminalMarker } from '../../platform/macos/terminal-session';
import { identityKeyFor } from '../kind-registry';
import { normalizeDirectory } from './compose-spec';

/**
 * The terminal-window resource spec (see terminal-kind.ts), apart from
 * the kind so terminal-tool.ts can build specs and markers without the
 * kind's dependencies.
 */

export const TERMINAL_WINDOW_KIND = 'terminal-window';
export const TERMINAL_BUNDLE_ID = 'com.apple.Terminal';

/**
 * One terminal of a Terminal step: its directory (lexically
 * normalized), its commands, and `occurrence` — which of several
 * identical entries in the same step this is, so two identical
 * terminals are still two resources.
 */
export function terminalWindowResource(
  cwd: string,
  commands: readonly string[],
  occurrence: number,
  tilt?: { downCommand: string; stopOnClose: boolean },
): ResourceSpec {
  const directory = normalizeDirectory(expandHome(cwd));
  return {
    kind: TERMINAL_WINDOW_KIND,
    identity: { cwd: directory, commands: JSON.stringify(commands), occurrence },
    label: `Terminal (${commands[0] ?? basename(directory)})`,
    // Tilt (a Docker step on the Tilt engine) is a terminal too, closed
    // its own way — see terminal-kind.ts's close. Not part of the
    // identity: a Terminal step running `tilt up` in the same directory
    // is the same terminal.
    ...(tilt ? { options: { engine: 'tilt', ...tilt } } : {}),
  };
}

/** The marker a terminal's script puts in its window title — derived from its identity. */
export function markerOf(identity: ResourceSpec['identity']): string {
  return terminalMarker(identityKeyFor({ identity }));
}
