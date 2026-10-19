import { Icon } from '../icons';
import { cn } from '../lib/utils';
import { toolBadgeClasses } from '../lib/tool-colors';
import { getToolLogoSrc } from '../lib/tool-logos';
import { useAppIcon } from '../lib/useAppIcon';

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
  /** This step's params — only read for the 'app' type (its `path`, to
   * fetch that specific app's own real icon via useAppIcon). Every
   * other type's badge is either a static bundled logo or the generic
   * tinted icon, neither of which needs per-step data. */
  params: Record<string, unknown>;
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
export function ToolBadge({ type, icon, color, size, chipClassName, params }: ToolBadgeProps): JSX.Element {
  const logoSrc = getToolLogoSrc(type);
  // The generic 'app' type has no static bundled logo (it can point at
  // any installed app) — fetch that specific app's own real icon
  // instead, lazily, via the shared cache. useAppIcon handles `path`
  // undefined (any other type, or no app chosen yet) by just returning
  // null, so this hook call is unconditional (rules of hooks) but only
  // ever does real work for 'app' steps.
  const appPath = type === 'app' && typeof params['path'] === 'string' ? params['path'] : undefined;
  const appIcon = useAppIcon(appPath);
  const imgSrc = logoSrc ?? appIcon;

  if (imgSrc) {
    // Extracted app icons (unlike the curated logoSrc assets, which
    // were trimmed tight for exactly this badge size) bake in macOS's
    // standard icon safe-area padding — Finder/Launchpad render them
    // the same way — making them look visibly smaller than every other
    // type's logo at the same chip size. Scaled up and clipped via
    // overflow-hidden to compensate, only for the 'app' case; logoSrc
    // is unaffected (overflow-hidden is a no-op there, already sized
    // exactly to fit).
    const imgSize = type === 'app' ? size * 1.35 : size;
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-elevated',
          chipClassName,
        )}
      >
        <img src={imgSrc} width={imgSize} height={imgSize} alt="" className="shrink-0" />
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
