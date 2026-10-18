export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'workspace-launcher:theme';

/**
 * Pure: validates a raw stored value, defaulting to 'dark' for
 * anything else — including never-set (null), a typo, or a value from
 * a future version of this app this build doesn't recognize. 'dark' is
 * this app's only-ever-shipped behavior before light mode existed, so
 * it's the safe default, not an arbitrary one.
 */
export function resolveStoredTheme(raw: string | null): Theme {
  return raw === 'light' ? 'light' : 'dark';
}

/**
 * Applies `theme` to the live DOM — the single place that decides how
 * a Theme value maps to the `data-theme` attribute styles.css's light-
 * mode selector matches on. 'dark' removes the attribute entirely
 * (rather than setting data-theme="dark") so the no-attribute case
 * theme-bootstrap.js's cold-start default already produces needs no
 * separate code path here.
 */
export function applyTheme(theme: Theme): void {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/**
 * Best-effort persistence — a failed localStorage write (e.g. storage
 * disabled) still lets applyTheme update this session's UI; it just
 * won't survive a restart. Never throws.
 */
export function getStoredTheme(): Theme {
  try {
    return resolveStoredTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Best-effort only — see applyTheme call below, which still runs.
  }
  applyTheme(theme);
}
