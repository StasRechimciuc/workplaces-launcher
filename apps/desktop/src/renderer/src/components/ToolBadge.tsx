import { Icon } from '../icons';
import { cn } from '../lib/utils';
import { toolBadgeClasses } from '../lib/tool-colors';
import { getToolLogoSrc } from '../lib/tool-logos';

interface ToolBadgeProps {
  /** The step type this badge represents (e.g. "vscode") — looked up
   * against the real-logo map; falls back to the generic tinted icon
   * for any type without one (docker/terminal/slack today). */
  type: string;
  icon: string;
  color: string;
  size: number;
  /** Sizing/shape classes for the chip itself (e.g. "h-7 w-7 text-[15px]") — the
   * two call sites use different badge sizes, so this isn't hardcoded here. */
  chipClassName: string;
}

/**
 * A real logo is a full-color image with no "tint from parent" concept,
 * unlike the generic Icon component (a single-color stroke glyph tinted
 * via CSS currentColor) — so a real-logo badge always sits on the same
 * neutral chip background regardless of the step's assigned `color`,
 * while a generic-icon badge keeps the existing per-color tinted chip.
 * Mixing both models into one background rule would misrepresent
 * whichever type doesn't have a resolved src, so the fork is explicit.
 */
export function ToolBadge({ type, icon, color, size, chipClassName }: ToolBadgeProps): JSX.Element {
  const logoSrc = getToolLogoSrc(type);

  if (logoSrc) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-sm bg-bg-elevated',
          chipClassName,
        )}
      >
        <img src={logoSrc} width={size} height={size} alt="" className="shrink-0" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-sm',
        toolBadgeClasses(color),
        chipClassName,
      )}
    >
      <Icon name={icon} size={size} />
    </span>
  );
}
