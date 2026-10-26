import { posixBasename } from './posix-basename';

/**
 * Sanitizes a directory path's basename into a Compose-legal project
 * name for the default `-p <name>` baked into docker-fields.tsx's
 * auto-filled commands — real constraint, not a style choice: `docker
 * compose -p` requires lowercase alphanumeric/`-`/`_`, starting with an
 * alphanumeric character, and rejects anything else outright.
 */
export function sanitizeComposeProjectName(directoryPath: string): string {
  const base = posixBasename(directoryPath);
  const lowered = base.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const cleaned = lowered.replace(/^[^a-z0-9]+/, '');
  return cleaned.length > 0 ? cleaned : 'project';
}
