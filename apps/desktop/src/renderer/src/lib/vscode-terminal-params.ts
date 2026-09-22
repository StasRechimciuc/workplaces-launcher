/**
 * Pure data transforms for WorkspaceFormModal.tsx's vscode-step terminal-
 * commands field. Extracted out of the component (same precedent as
 * packages/shared/src/vscode-restore.ts / write-file-atomic.ts being
 * pulled out purely to be unit-testable outside their host runtime) so
 * this logic — which has no DOM/React dependency at all — has actual
 * regression coverage instead of living only inside a textarea's
 * onChange handler where nothing exercises it.
 */

/**
 * The v1 UI exposes exactly one terminal's commands (the schema itself
 * supports N — see vscode-tool.ts's VSCodeTerminalParamsSchema array —
 * a second terminal row is a UI-only addition later if ever wanted, no
 * backend change required).
 */
export function getFirstTerminalCommands(params: Record<string, unknown>): string[] {
  const terminals = Array.isArray(params['terminals']) ? params['terminals'] : [];
  const first: unknown = terminals[0];
  if (typeof first !== 'object' || first === null) {
    return [];
  }
  const commands = (first as Record<string, unknown>)['commands'];
  return Array.isArray(commands) ? commands.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * Replaces only terminal[0]'s commands — preserves any additional
 * terminal entries beyond what this v1 UI surfaces
 * (getFirstTerminalCommands above only reads index 0). Rebuilding the
 * whole array as `[{ commands: nextCommands }]` unconditionally would
 * silently discard terminals[1+] the moment this field is touched, for
 * any config with more than one terminal (reachable via a hand-edited
 * or future-imported config file) — this is the fix for that exact bug,
 * kept here so it stays covered by a regression test.
 *
 * Deliberate tradeoff when clearing the field entirely (nextCommands is
 * []): terminal[0] is *dropped*, not kept as an empty-commands
 * placeholder, so any terminals[1+] shift up to fill the gap. The
 * alternative (always keep a terminal[0] entry, even empty) would break
 * the common single-terminal case's actual purpose — an empty commands
 * array still has `terminals.length > 0`, so vscode-tool.ts would stage
 * a pointless restore that creates a terminal and runs nothing, instead
 * of correctly staging nothing at all. Multi-terminal configs are only
 * reachable via a hand-edited/imported file (the v1 UI can't create
 * one), so this tradeoff favors the common case over a rare one, not
 * ignoring it.
 */
export function mergeFirstTerminalCommands(
  params: Record<string, unknown>,
  nextCommands: string[],
): unknown[] {
  const existingTerminals = Array.isArray(params['terminals']) ? params['terminals'] : [];
  const restTerminals = existingTerminals.slice(1);
  const firstTerminal = nextCommands.length > 0 ? [{ commands: nextCommands }] : [];
  return [...firstTerminal, ...restTerminals];
}
