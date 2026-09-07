import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Expands a leading `~` (or `~/...`) to the user's home directory.
 * Needed because lib/shell-exec.ts never runs through a shell
 * (shell:false, for command-injection safety — see claude.md's Code
 * Quality Standard), so nothing else expands `~` the way an
 * interactive shell normally would — `open ~/projects/x` typed in
 * Terminal works because the shell expands it before `open` ever sees
 * it; called via execFile directly, `open` receives the literal
 * three-character string "~" and treats it as a real path segment.
 */
export function expandHome(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }
  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}
