import { runCommand } from '../../lib/shell-exec';
import { realTabUrl } from '../browser-placeholder';

/**
 * A browser's windows and tabs through its scripting interface (WCs/
 * WC__window-tracking.md, Phase 4) — what Accessibility can't give: a
 * tab's URL, and a window name that survives the browser restarting.
 *
 * The Chromium family (Chrome, Brave, Edge) shares one scripting
 * vocabulary, addressed here by its raw codes rather than by name, so
 * driving Brave never needs Chrome installed. Every value reaches the
 * script as an argument (`argv`), never spliced into its text.
 *
 * Needs the user's "control <browser>" (Automation) permission; macOS
 * asks once, on the first call. Never launches the browser: every
 * script checks it's running first.
 */

export interface BrowserTab {
  title: string;
  url: string;
}

export interface BrowserWindow {
  /** The browser's own window id — valid until the browser restarts. */
  scriptId: string;
  /** Chrome's "Name window" — survives restarts and crashes. */
  name: string;
  /** Screen position and size — matches the window's Accessibility frame. */
  frame: { x: number; y: number; width: number; height: number };
  incognito: boolean;
  /** 1-based, like the browser's own. */
  activeTabIndex: number;
  /** Placeholder tabs already reported as the tab they stand for. */
  tabs: BrowserTab[];
}

export type BrowserFailureCode = 'denied' | 'not-running' | 'failed';
export type BrowserResult<T> =
  { ok: true; value: T } | { ok: false; code: BrowserFailureCode; message: string };

export interface BrowserAdapter {
  /** The app name scripts address, e.g. "Google Chrome". */
  readonly appName: string;
  readWindows(): Promise<BrowserResult<BrowserWindow[]>>;
  nameWindow(scriptId: string, name: string): Promise<BrowserResult<void>>;
  setActiveTab(scriptId: string, index: number): Promise<BrowserResult<void>>;
}

const SCRIPT_TIMEOUT_MS = 10_000;
// Field and record separators that can't appear in a title or URL.
const US = '\u001f';
const RS = '\u001e';

// Each window's tabs are read in one request per property (not one per
// tab), so the user changing tabs mid-read can't shift what's being
// walked; a mismatch still raises -1719 and the read is retried.
// Every title, name and URL goes through clean(): a page controls its
// own title, and a separator inside it could forge a window or tab.
// Incognito windows are reported (so nothing mistakes them for others)
// but their tabs are never read.
const READ_WINDOWS = `on clean(t)
  set AppleScript's text item delimiters to {character id 30, character id 31}
  set parts to text items of (t as text)
  set AppleScript's text item delimiters to " "
  set cleaned to parts as text
  set AppleScript's text item delimiters to ""
  return cleaned
end clean

on run argv
  set appName to item 1 of argv
  if application appName is not running then return "NOT-RUNNING"
  set US to character id 31
  set RS to character id 30
  set out to ""
  tell application appName
    repeat with w in (every window)
      try
        set windowName to «class GNam» of w
      on error
        set windowName to ""
      end try
      if windowName is missing value then set windowName to ""
      set b to bounds of w
      set windowMode to «class mode» of w
      if windowMode is "incognito" then
        set tabTitles to {}
        set tabUrls to {}
      else
        set tabTitles to name of every «class CrTb» of w
        set tabUrls to «class URL » of every «class CrTb» of w
      end if
      if (count of tabTitles) is not (count of tabUrls) then error "tabs changed while reading" number -1719
      set out to out & "W" & US & (id of w as text) & US & my clean(windowName) & US & (item 1 of b) & US & (item 2 of b) & US & (item 3 of b) & US & (item 4 of b) & US & windowMode & US & («class acTI» of w) & RS
      repeat with i from 1 to count of tabTitles
        set out to out & "T" & US & my clean(item i of tabTitles) & US & my clean(item i of tabUrls) & RS
      end repeat
    end repeat
  end tell
  return out
end run`;

const NAME_WINDOW = `on run argv
  set appName to item 1 of argv
  if application appName is not running then return "NOT-RUNNING"
  tell application appName
    repeat with w in windows
      if (id of w as text) is item 2 of argv then
        set «class GNam» of w to item 3 of argv
        return "OK"
      end if
    end repeat
  end tell
  return "NO-WINDOW"
end run`;

const SET_ACTIVE_TAB = `on run argv
  set appName to item 1 of argv
  if application appName is not running then return "NOT-RUNNING"
  tell application appName
    repeat with w in windows
      if (id of w as text) is item 2 of argv then
        set «class acTI» of w to (item 3 of argv as integer)
        return "OK"
      end if
    end repeat
  end tell
  return "NO-WINDOW"
end run`;

export function createChromiumAdapter(appName: string): BrowserAdapter {
  async function run(script: string, args: string[]): Promise<BrowserResult<string>> {
    const result = await runCommand('osascript', ['-e', script, appName, ...args], {
      timeoutMs: SCRIPT_TIMEOUT_MS,
    });
    if (!result.success) {
      const detail = `${result.stderr} ${result.message}`;
      // errAEEventNotPermitted: the user didn't allow (or hasn't been asked to allow) control.
      if (/-1743\b/.test(detail)) {
        return {
          ok: false,
          code: 'denied',
          message: `Workspace Launcher isn't allowed to control ${appName} — turn it on in System Settings > Privacy & Security > Automation.`,
        };
      }
      return {
        ok: false,
        code: 'failed',
        message: `Couldn't talk to ${appName}: ${result.stderr.trim() || result.message}`,
      };
    }
    const output = result.stdout.replace(/\n$/, '');
    if (output === 'NOT-RUNNING') {
      return { ok: false, code: 'not-running', message: `${appName} isn't running.` };
    }
    return { ok: true, value: output };
  }

  async function runOnWindow(script: string, args: string[]): Promise<BrowserResult<void>> {
    const result = await run(script, args);
    if (!result.ok) return result;
    if (result.value !== 'OK') {
      return { ok: false, code: 'failed', message: `${appName} has no such window any more.` };
    }
    return { ok: true, value: undefined };
  }

  return {
    appName,

    async readWindows() {
      // A window or tab closing mid-read ("invalid index", -1719 /
      // "no such object", -1728) is the user working, not a failure:
      // read again.
      let result = await run(READ_WINDOWS, []);
      for (
        let retry = 0;
        retry < 2 && !result.ok && /\(-17(19|28)\)/.test(result.message);
        retry++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        result = await run(READ_WINDOWS, []);
      }
      if (!result.ok) return result;
      return { ok: true, value: parseWindows(result.value) };
    },

    nameWindow(scriptId, name) {
      return runOnWindow(NAME_WINDOW, [scriptId, name]);
    },

    setActiveTab(scriptId, index) {
      return runOnWindow(SET_ACTIVE_TAB, [scriptId, String(index)]);
    },
  };
}

/** Parses READ_WINDOWS's output: a W record, then that window's T records. */
export function parseWindows(output: string): BrowserWindow[] {
  const windows: BrowserWindow[] = [];
  for (const record of output.split(RS)) {
    const fields = record.split(US);
    if (fields[0] === 'W' && fields.length >= 9) {
      const [left, top, right, bottom] = fields.slice(3, 7).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      windows.push({
        scriptId: fields[1]!,
        name: fields[2]!,
        frame: { x: left, y: top, width: right - left, height: bottom - top },
        incognito: fields[7] === 'incognito',
        activeTabIndex: Number(fields[8]) || 1,
        tabs: [],
      });
    } else if (fields[0] === 'T' && fields.length >= 3 && windows.length > 0) {
      windows.at(-1)!.tabs.push({ title: fields[1]!, url: realTabUrl(fields.slice(2).join(US)) });
    }
  }
  return windows;
}
