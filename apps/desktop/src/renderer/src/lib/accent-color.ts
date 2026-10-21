const STORAGE_KEY = 'workspace-launcher:accent-color';

/** The one shipped default, matching styles.css's own `--color-accent`
 * — used by Settings to know what "Reset to default" actually resets
 * to, without duplicating the hex as a second literal. */
export const DEFAULT_ACCENT_COLOR = '#3b6cf0';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Pure: validates a raw stored value, defaulting to null (no override
 * — styles.css's own `--color-accent` default applies) for anything
 * else, including never-set, a typo, or a value from a future version
 * of this app this build doesn't recognize. Same "validate and default
 * safely" shape as lib/theme.ts's resolveStoredTheme.
 */
export function resolveStoredAccentColor(raw: string | null): string | null {
  return raw !== null && HEX_COLOR_RE.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Applies `color` to the live DOM by overriding --color-accent inline
 * on <html> — every derived shade (accent-hover/-soft/-border) is a
 * color-mix() off this one variable in styles.css, so nothing else
 * needs touching. `null` removes the override, falling back to
 * styles.css's own shipped default (same no-attribute-means-default
 * shape as lib/theme.ts's applyTheme for 'dark').
 */
export function applyAccentColor(color: string | null): void {
  if (color !== null) {
    document.documentElement.style.setProperty('--color-accent', color);
  } else {
    document.documentElement.style.removeProperty('--color-accent');
  }
}

/**
 * Best-effort persistence — a failed localStorage write (e.g. storage
 * disabled) still lets applyAccentColor update this session's UI; it
 * just won't survive a restart. Never throws.
 */
export function getStoredAccentColor(): string | null {
  try {
    return resolveStoredAccentColor(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Rejects a value that doesn't look like a real hex color rather than
 * persisting/applying garbage — defense in depth, since the only
 * current caller is a native `<input type="color">`, which the HTML
 * spec already guarantees always produces a valid `#rrggbb` string. */
export function setStoredAccentColor(color: string): void {
  if (!HEX_COLOR_RE.test(color)) {
    return;
  }
  const normalized = color.toLowerCase();
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Best-effort only — see applyAccentColor call below, which still runs.
  }
  applyAccentColor(normalized);
}

export function resetAccentColor(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only — see applyAccentColor call below, which still runs.
  }
  applyAccentColor(null);
}
