// Applies the persisted theme and accent color to <html> before React
// mounts, so the first paint is never a flash of the wrong theme or
// the default blue before a custom color applies. Must be a real,
// same-origin external script (not inline) — index.html's CSP is
// script-src 'self' with no 'unsafe-inline', so an inline <script>
// here would be silently blocked and never run. Keep this in sync with
// lib/theme.ts's and lib/accent-color.ts's STORAGE_KEY/resolve*
// logic — duplicated intentionally, not imported: this file runs
// standalone, before any bundled module (including those) has loaded.
(function () {
  try {
    if (localStorage.getItem('workspace-launcher:theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch {
    // Best-effort only — a storage read failure just means this cold
    // load renders dark (this app's default), same as having no stored
    // preference at all.
  }

  try {
    const accent = localStorage.getItem('workspace-launcher:accent-color');
    if (accent !== null && /^#[0-9a-f]{6}$/i.test(accent)) {
      document.documentElement.style.setProperty('--color-accent', accent);
    }
  } catch {
    // Best-effort only — a storage read failure just means this cold
    // load renders styles.css's own shipped default accent color.
  }
})();
