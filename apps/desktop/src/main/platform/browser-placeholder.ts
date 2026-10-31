/**
 * Placeholder tabs (WCs/WC__window-tracking.md, Phase 4): restoring a
 * browser window loads only the tab the user lands on; every other tab
 * opens as a tiny page with the real tab's title that replaces itself
 * with the real URL the moment the tab is shown. No browser can be told
 * from outside to open a tab unloaded (only its extensions can), and
 * loading every saved tab at once is a CPU and network spike.
 *
 * Only http(s) tabs get one: a page can't navigate itself to a
 * browser-internal URL (chrome://…), and those are cheap to load anyway.
 */

const PLACEHOLDER_MARK = '<!--workspace-launcher-placeholder-->';
const DATA_PREFIX = 'data:text/html;charset=utf-8,';

export function canBePlaceholder(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * The URLs to open a restored window with. The browser always shows
 * the first tab, so that one is real; every other web tab is a
 * placeholder (`chrome://` pages, which can't be, are passed as they
 * are — Chrome itself drops them when opened this way).
 */
export function restoreUrls(tabs: readonly { title: string; url: string }[]): string[] {
  return tabs.map((tab, i) =>
    i === 0 || !canBePlaceholder(tab.url) ? tab.url : placeholderUrl(tab.url, tab.title),
  );
}

/** The placeholder page's `data:` URL for one tab. */
export function placeholderUrl(url: string, title: string): string {
  const html = [
    '<!doctype html>',
    PLACEHOLDER_MARK,
    `<title>${escapeHtml(title || url)}</title>`,
    // JSON.stringify makes the URL a safe JS string; `<` is escaped too
    // so nothing in it can close the script element early.
    `<script>const u=${JSON.stringify(url).replace(/</g, '\\u003c')};`,
    'const go=()=>{if(!document.hidden)location.replace(u)};',
    'go();document.addEventListener("visibilitychange",go)</script>',
  ].join('');
  return `${DATA_PREFIX}${encodeURIComponent(html)}`;
}

/**
 * The real URL behind a tab: a placeholder never visited is still its
 * `data:` page — it's saved as the tab it stands for. Anything else is
 * returned unchanged.
 */
export function realTabUrl(url: string): string {
  if (!url.startsWith(DATA_PREFIX)) return url;
  let html: string;
  try {
    html = decodeURIComponent(url.slice(DATA_PREFIX.length));
  } catch {
    return url;
  }
  if (!html.includes(PLACEHOLDER_MARK)) return url;
  const match = /const u=("(?:[^"\\]|\\.)*");/.exec(html);
  if (!match) return url;
  try {
    const real: unknown = JSON.parse(match[1]!);
    return typeof real === 'string' && canBePlaceholder(real) ? real : url;
  } catch {
    return url;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
