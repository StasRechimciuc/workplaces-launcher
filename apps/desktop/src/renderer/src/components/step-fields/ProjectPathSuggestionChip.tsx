import type { ReactNode } from 'react';
import { Icon } from '../../icons';

/**
 * The "Use X's folder: Y" (or similar) suggestion chip — identical
 * className/icon across every project-path-shaped field (vscode/
 * docker/terminal-fields.tsx), confirmed byte-for-byte before this was
 * extracted. `label` is a full ReactNode, not a fixed "Use {source}'s
 * folder: {path}" template string, because one real call site's
 * wording genuinely differs ("Add a terminal using...", for adding a
 * brand-new terminal card pre-filled with the suggested path, not just
 * setting an existing field) — forcing it into one template would
 * either be wrong there or require a second near-duplicate component.
 */
export function ProjectPathSuggestionChip({
  label,
  onClick,
}: {
  label: ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="flex h-6 w-fit items-center gap-1.25 self-start rounded-[5px] px-1.5 text-[11px] text-text-faint hover:bg-bg-hover hover:text-text-muted"
      onClick={onClick}
    >
      <Icon name="folder" size={11} />
      {label}
    </button>
  );
}
