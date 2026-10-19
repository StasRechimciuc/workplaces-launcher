# Generic App Launcher ("App" step type)

A step type that isn't hardcoded to one specific app — pick any installed
macOS app via a native picker and just launch it on restore. The unlock
for non-dev personas (office/Excel, design/Figma) who need to use this
tool without the founder hand-writing a new `*-tool.ts` file per app.
Source of truth is `tools/app-tool.ts` and `platform/app-icon.ts`; this
doc explains both the design and — at real length, because it was a real
debugging saga worth not re-learning — the icon-extraction journey.

## What it does

- A new `'app'` step type, params `{ path: string }` — the full `.app`
  bundle path.
- Picked via a native `openFile` dialog filtered to `.app` bundles
  (`dialog:selectApp`), defaulting to `/Applications` — Browse-only, no
  manual text entry, consistent with this app's "no manual typing"
  picker direction (the exact path isn't something worth typing from
  memory, unlike e.g. a VS Code project path).
- Launched via the **already-existing** `PlatformLauncher.launchApp`.
- The step's badge shows that specific app's own real icon (not a
  generic placeholder), and its title shows the app's real name (e.g.
  "Figma"), not the literal string "App" — both added as same-day
  founder-caught follow-ups, covered below.

## No new launcher code needed

Confirmed by reading the code, not assumed: `PlatformLauncher.launchApp
(appName: string)` already existed and is already fully generic — its
macOS implementation just forwards the argument into `open -a
"<value>"` via `lib/shell-exec.ts`'s `runCommand` (argv array,
`shell:false`, never shell-interpreted). `open -a` accepts a full bundle
path exactly like it accepts a bare app name, so a user-picked path
passes straight through with zero changes to the platform layer. The two
existing callers (`vscode-tool.ts`, `spotify-tool.ts`) just happened to
always pass a hardcoded name; nothing about the function itself was
name-specific.

## Why a native dialog, not a custom app-enumerator

The other real option was scanning `/Applications` + `~/Applications`
and building a searchable dropdown, matching the Chrome-profile picker's
shape. Rejected: no such enumeration existed anywhere in this codebase
already (confirmed via search), it would mean parsing `Info.plist` for
display names and maintaining that scan, and it's *less* robust than the
native dialog — a user-picked path works for literally any app anywhere
on disk, not just ones under the two conventional Applications folders.
The native `openFile` dialog is both less new code and a better result.

## macOS-only scope cut

Deliberate, documented, not revisited here: Windows has no equivalent of
`open -a` resolving an arbitrary app by name or path — it would need the
same registry-based app-path lookup `platform/windows/app-paths.ts`
already does for named apps, which doesn't exist yet for an arbitrary
user-picked one.

## Dynamic display name

The generic type isn't one fixed thing, unlike every other type (a "VS
Code" step is always VS Code) — showing the literal `STEP_TYPES` name
("App") for every instance is useless once a workspace has more than one
App step (which app?). `appDisplayName(path)`
(`packages/shared/src/app-display-name.ts`, pure string logic — strips
the directory and a trailing `.app` suffix) derives the real name
whenever a path is chosen, falling back to generic "App" only for a
not-yet-configured step. One implementation, reused in four places that
each used to have — or would otherwise have needed — their own copy:
`app-tool.ts`'s `detail()`/`expand()` text, `config/workspace-display.ts`
(the Detail view's step title), `step-fields/app-fields.tsx` (replacing a
local duplicate), and `WorkspaceFormModal.tsx`'s Tools list (same gap,
same fix).

## The icon-extraction saga

This is the part worth reading in full before touching this code again —
three attempts, a wrong root-cause diagnosis along the way, and a real
lesson about where to look when "I fixed the data but it still looks
broken."

### Attempt 1 (shipped, then proven wrong): Electron's `app.getFileIcon()`

Looked correct on paper — a built-in Electron API, no shell-out, no
native module. Shipped. The founder immediately caught it showing the
*same* generic, broken-image-looking icon for every App step regardless
of which app was configured. Root-caused by directly calling
`window.api.getAppIcon()` for several real, visually distinct apps
(Music, Notes, Calculator, a third-party app) and diffing the results:
byte-identical every time. `getFileIcon` doesn't actually resolve a
`.app` bundle's custom icon resource at all — because a `.app` bundle is
technically a *directory*, and `getFileIcon` falls back to a generic
icon for directories rather than reading the bundle's real icon.

### Attempt considered and discarded: QuickLook (`qlmanage -t`)

The same mechanism Finder uses for preview thumbnails — tested manually
via shell and confirmed it **does** resolve real icons correctly. But
`qlmanage -t` writes its output to a file (not stdout, needing temp-file
handling) and is backed by a system daemon that hung for an extended
period during manual testing. Discarded as unsafe for something a user
triggers directly by picking an app — a hang here would block icon
resolution with no bound.

### Attempt 2 (the actual fix): `Info.plist` + `sips`

The mechanism Finder itself ultimately relies on: read the bundle's own
`Info.plist` for `CFBundleIconFile` (historically without its `.icns`
extension spelled out — appended if missing), locate that file under
`Contents/Resources/`, convert it to PNG via `sips`. Both standard macOS
CLI tools, no new dependency, no native module. Verified manually by
hand *before* writing any code — extracted and visually viewed Music.app's
and Notes.app's real icons via raw shell commands, confirmed they were
genuinely correct and genuinely different, only then wrote
`platform/app-icon.ts` around that confirmed-working mechanism. Both
shell-outs go through `shell-exec.ts`'s `runCommand` (argv array,
`shell:false`) — the app's own path and every derived file path are
never concatenated into a shell string.

Bounded with a 5-second timeout per command (`plutil`/`sips` are normally
sub-second local operations, but this guards against the kind of hang
`qlmanage` demonstrated). Fails gracefully (returns `null`, never
throws) at every step: a missing `Info.plist`, no `CFBundleIconFile` key
(a known, accepted limitation — an app shipping *only* an asset-catalog
icon with no legacy `.icns` fallback isn't handled), a missing icon file,
or `sips` itself failing. The temp PNG `sips` writes to is always cleaned
up via `finally` + a swallowed `unlink` error (it may never have been
written at all if `sips` failed before reaching `--out`).

### The real root cause, found only after both icon-extraction attempts looked done

The founder reported "same issue" even after the `sips` fix, and even
after a full app quit+restart (ruling out stale-build/stale-window
theories). Every diagnostic up to that point had only checked
`window.api.getAppIcon()`'s raw *string* return value — never whether an
`<img>` actually rendered it. Driving a live Playwright session and
reading the **renderer console** (not the main-process terminal, which
had logged nothing, since this error never reaches it) found the actual
cause immediately:

```
Refused to load the image 'data:image/png;base64,...' because it
violates the following Content Security Policy directive:
"default-src 'self'". Note that 'img-src' was not explicitly set,
so 'default-src' is used as a fallback.
```

`index.html`'s CSP had no `img-src` directive, so it fell back to
`default-src 'self'` — which blocks `data:` image URIs outright. The
browser refused to load the icon, the `<img>` rendered at 0×0, and fell
back to its own native broken-image glyph. This is **why attempt 1 and
attempt 2 looked identical**: the CSP block happens after icon
generation, so it didn't matter which extraction method produced the
data — both were discarded by the browser before ever reaching the
screen. It's also why restarting never helped (a renderer-level policy
block, not a staleness problem) and why the terminal stayed silent (a
CSP violation is a DevTools-console-only error, never main-process
stderr).

Fixed with a minimal, scoped CSP change — `img-src 'self' data:;` added
alongside the existing `default-src`/`script-src`/`style-src` directives,
nothing else loosened. A `data:` image can't execute script or load
further external resources, so this doesn't weaken any other directive.

**The lesson, if this class of bug resurfaces**: when a renderer-visible
feature "still doesn't work" after the underlying data has been proven
correct by every test that checks the raw value, the next place to look
is whether the data actually *renders* — and specifically the DevTools
console, not the main process's own log output, since a CSP violation,
a React error, or any other renderer-level failure never reaches the
terminal running `npm run dev` at all.

### Icon padding (same pass, also founder-caught)

Once icons rendered at all, they looked visibly smaller than the other
types' logos at the same badge size. Real extracted `.icns`/app-icon
resources bake in macOS's standard icon safe-area padding (the same
convention Finder/Launchpad render) — unlike the curated, hand-trimmed
logo SVGs used for vscode/chrome/spotify/clockify, which have no such
margin. Fixed by scaling the `'app'` type's `<img>` up (~1.35×) and
clipping it to the chip via `overflow-hidden`, scoped to that case only —
`ToolBadge.tsx`'s other logo rendering is untouched.

## Caching

The extracted icon is fetched lazily and cached in-memory,
renderer-side, keyed by path (`lib/app-icon-cache.ts`, a pure module
tested directly — cache hit/miss/concurrent-call dedupe — wrapped by a
thin, untested React hook `lib/useAppIcon.ts`, the same split this
codebase already uses for `useGlobalShortcuts.ts`/`matchesCombo`).
Deliberately **not** persisted to disk or embedded in the workspace
config: re-deriving an icon is cheap, and persisting it would create a
staleness problem (the app's own icon can change after an update) with
no signal available to detect and invalidate it.

## Testing

`app-tool.test.ts` covers validate/run/teardown/detail/expand.
`app-icon.test.ts` mocks `runCommand`/`fs` to cover the full
`Info.plist`→`sips`→data-URL chain and every failure branch (missing
key, blank value, `sips` failure, read failure, cleanup failure never
propagating). `app-icon-cache.test.ts` covers the cache/dedupe logic
directly, no DOM needed. `app-display-name.test.ts` covers the shared
name-derivation helper. `handlers.test.ts` covers the `dialog:selectApp`
and `app:getIcon` IPC handlers with `getAppIconDataUrl` mocked wholesale
(its own extraction logic is `app-icon.test.ts`'s job). Live-verified via
Playwright driving the real built app, including a real restore that
actually launched `/System/Applications/Calculator.app` and reported a
genuine success — and, for the icon pipeline specifically, by rendering
real `<img>` elements in a live session and reading their actual
`naturalWidth`/`naturalHeight`/console output rather than trusting the
raw IPC string alone (see "The real root cause" above for why that
distinction mattered).
