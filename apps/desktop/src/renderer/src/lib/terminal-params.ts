/**
 * Pure data transforms for WorkspaceFormModal.tsx's terminal-step
 * fields — same extraction precedent as vscode-terminal-params.ts
 * (pulled out of the component purely to be unit-testable outside its
 * host runtime). Can't reuse vscode-terminal-params.ts directly: its
 * `terminals` shape is `{ commands }[]` (no cwd — a vscode step
 * inherits its cwd from the project folder), while a standalone
 * terminal step needs its own `cwd` per entry.
 */

export interface TerminalEntryDraft {
  cwd: string;
  commands: string[];
}

function toEntry(raw: unknown): TerminalEntryDraft {
  if (typeof raw !== 'object' || raw === null) {
    return { cwd: '', commands: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    cwd: typeof obj['cwd'] === 'string' ? obj['cwd'] : '',
    commands: Array.isArray(obj['commands'])
      ? obj['commands'].filter((c): c is string => typeof c === 'string')
      : [],
  };
}

export function getTerminalEntries(params: Record<string, unknown>): TerminalEntryDraft[] {
  const terminals = Array.isArray(params['terminals']) ? params['terminals'] : [];
  return terminals.map(toEntry);
}

export function addTerminalEntry(params: Record<string, unknown>): TerminalEntryDraft[] {
  // Defaults to the home directory — the same default Terminal.app
  // itself opens a fresh window to, not an arbitrary blank field. The
  // user can still overwrite or Browse to anything else; this just
  // removes the one keystroke for the common "I don't care, just open
  // somewhere sane" case. '~' is already a fully valid, tested cwd
  // value (isAcceptableToolPath/expandHome both handle the bare form).
  return [...getTerminalEntries(params), { cwd: '~', commands: [] }];
}

export function removeTerminalEntry(
  params: Record<string, unknown>,
  index: number,
): TerminalEntryDraft[] {
  return getTerminalEntries(params).filter((_, i) => i !== index);
}

export function updateTerminalEntry(
  params: Record<string, unknown>,
  index: number,
  next: Partial<TerminalEntryDraft>,
): TerminalEntryDraft[] {
  return getTerminalEntries(params).map((entry, i) => (i === index ? { ...entry, ...next } : entry));
}
