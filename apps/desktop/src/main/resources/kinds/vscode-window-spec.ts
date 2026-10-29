import { basename } from 'node:path';
import { VSCODE_APP_NAME, type ResourceSpec } from '@workspace-launcher/shared';
import { expandHome } from '../../lib/paths';
import { normalizeDirectory } from './compose-spec';

/**
 * The VS Code window resource spec (see vscode-window-kind.ts), kept
 * apart from the kind so vscode-tool.ts and the orchestrator can refer
 * to it without pulling in the kind's dependencies.
 */

export const VSCODE_WINDOW_KIND = 'vscode-window';

/**
 * One VS Code window: which VS Code-family app (by bundle id — VS Code,
 * Insiders and Cursor are different apps with different windows) and
 * which folder (expanded, lexically normalized). VS Code itself allows
 * one window per folder, so the two together pick out one window.
 */
export function vscodeWindowResource(bundleId: string, folder: string): ResourceSpec {
  const normalized = normalizeDirectory(expandHome(folder));
  return {
    kind: VSCODE_WINDOW_KIND,
    identity: { bundleId, folder: normalized },
    label: `VS Code (${basename(normalized)})`,
    // How the app-level path names VS Code (tool-identity.ts): while this
    // window is owned, nothing quits the whole app.
    appName: VSCODE_APP_NAME,
  };
}
