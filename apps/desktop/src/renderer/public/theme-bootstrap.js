// Applies the persisted theme to <html> before React mounts, so the
// first paint is never a flash of the wrong theme. Must be a real,
// same-origin external script (not inline) — index.html's CSP is
// script-src 'self' with no 'unsafe-inline', so an inline <script>
// here would be silently blocked and never run. Keep this in sync with
// lib/theme.ts's STORAGE_KEY/resolveStoredTheme logic — duplicated
// intentionally, not imported: this file runs standalone, before any
// bundled module (including that one) has loaded.
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
})();
