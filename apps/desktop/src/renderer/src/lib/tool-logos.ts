/**
 * Real per-tool brand logos, served from public/tool-logos (see that
 * folder's NOTICE.md for sources/licenses). Only step types with a real,
 * legally-clear logo asset are listed here — everything else falls back
 * to the generic tinted stroke icon (see ToolBadge.tsx).
 *
 * Built with `${import.meta.env.BASE_URL}...`, not a hardcoded leading
 * slash: electron-vite's renderer base is relative (`./`), so an
 * absolute `/tool-logos/x.svg` path resolves against the filesystem
 * root under the packaged app's `file://` protocol — it only happens to
 * work in the dev server, where root-relative paths resolve against
 * localhost. BASE_URL is Vite's own documented fix for this.
 */
const TOOL_LOGO_FILES: Record<string, string> = {
  vscode: 'vscode.svg',
  spotify: 'spotify.svg',
  chrome: 'chrome.svg',
  clockify: 'clockify.svg',
};

export function getToolLogoSrc(type: string): string | undefined {
  const file = TOOL_LOGO_FILES[type];
  return file ? `${import.meta.env.BASE_URL}tool-logos/${file}` : undefined;
}
