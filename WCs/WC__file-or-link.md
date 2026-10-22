# File or Link — a new generic step type for documents and web links

A new workspace-step tool type (`type: 'link'`, display name "File or
Link") that opens a specific document or web link cold, optionally
with a chosen app instead of the OS/browser default. The second of the
three "widen appeal to more user domains without adding more app
integrations" ideas logged in `docs/build-shell.md`'s Tier 3, pulled
forward by direct founder request and judged through a full `/judge`
round (Stage 1 idea approval with real back-and-forth revision, Stage 2
technical plan with an adversarial review pass) before any code was
written.

## What it does

- **One field** (`target`): browse to a file via a native picker, or
  type/paste a link directly — no upfront "is this a file or a link?"
  choice. Classification happens automatically, both for execution and
  for how the step is displayed.
- **Optional "Open with"**: choose a specific installed app to open
  `target` with, instead of the OS/browser default — reuses the exact
  same app-picker dialog the existing "App" step type already has, and
  the exact same underlying primitive (`openInApp`), unchanged, for
  *both* a file path and a URL as the target.
- Links are restricted to `http://`/`https://` — see "Why http/https
  only, not a scheme blocklist" below for why this isn't a limitation
  in practice.
- Every real failure mode gets its own specific, honest message naming
  the actual path/URL — never one generic "couldn't open" bucket.

## Why this shape

### One field, not two step types, not a `kind` picker on `app`

Real prior art researched directly (Shortcuts.app's Open File/Open
URLs actions, Raycast Quicklinks, Alfred's file/URL actions, Keyboard
Maestro): every one of them except Raycast hard-codes File vs. URL as
two separate actions the user must pick between *before* providing a
value — and most of those also force a native-picker-only flow for
files, rejecting typed/pasted input entirely. Raycast is the outlier,
and the clear standout: one field, auto-detected at open-time, no
upfront classification the user has no intuition for ("is a Figma link
a file or a URL? is a Keynote deck a file or an app I open?"). That's
the pattern this step follows.

Extending the *existing* "App" step type with a `kind` discriminator
was considered and rejected: `app`'s `params.path` is hard-assumed to
be a literal `.app` bundle in roughly seven places across this codebase
(icon extraction, display naming — duplicated in two files already —
and the workspace-activity liveness/auto-close tracking), none of which
this codebase has ever needed a `z.discriminatedUnion` to route around.
A new, separate step type touches none of that, costs nothing extra
given how additively this project's tool registry already works
(`STEP_TYPES`, the main tool registry, the renderer step-fields
registry are all flat, type-keyed maps), and keeps `app` completely
untouched.

### Why http/https only, not a scheme blocklist

The original framing of this idea assumed supporting arbitrary app
deep-link schemes (`notion://`, `figma://`) was a real, motivating use
case. It isn't: when a real user hits "Copy link" in Notion or Figma,
they get a plain `https://notion.so/...` or `https://figma.com/file/...`
URL — neither app surfaces a custom-scheme link for a normal user to
copy at all. Restricting to `http://`/`https://` loses nothing real
users would actually paste, and matches Electron's own documented
security guidance for `shell.openExternal` directly instead of
reasoning around it (a blocklist approach was drafted first, then
revised once the custom-scheme use case was shown not to hold up).

The real version of "deep-link into the desktop app" people actually
want is covered by "Open with" instead: pasting the normal `https://`
Figma link anyone copies, then choosing "Open with → Figma," opens that
exact file directly in the desktop app via `open -a Figma <url>` —
macOS already hands a URL argument to a chosen app exactly as readily
as a file path (confirmed by reading `openInApp`'s actual
implementation, not assumed), so this needed no new code at all.

### Windows stays stubbed, deliberately

The actual opening mechanism (Electron's `shell.openPath`/
`shell.openExternal`) is already uniformly cross-platform — there's no
OS-specific code to write for Windows here, unlike every other tool
type. The temptation was to ship the real implementation on both
platforms since the code would be identical either way. Caught in
adversarial review: CLAUDE.md's "don't build platform code for more
than one OS at a time" isn't a statement about how much work a given OS
would take — it's "don't build it yet," full stop. Windows gets the
same honest `{ success: false, message: "...aren't implemented on
Windows yet." }` stub `openTerminal` already established as this
project's precedent, not a working implementation nobody asked to ship
early.

## Not considered stable — needs rethinking later

Flagged explicitly, not left implicit: the "Open with a specific app"
override has a real, unresolved gap. `open -a <App> <target>` tells
macOS to launch the chosen app and hand it the target regardless of
whether that app has any idea what to do with it — there's no API to
check compatibility beforehand, and no signal back to this process
about what the app actually did with it afterward. Pick an incompatible
pairing (a `.docx` "opened with" Figma, say) and this tool reports
success anyway, because `open` itself did succeed at its own narrow
job — the real outcome is entirely up to the target app, invisibly.

This wasn't caught during the `/judge` round or adversarial review —
it surfaced afterward, in a plain product conversation about what
happens with two incompatible apps. That's worth noting on its own:
this step type's edge cases may not be fully enumerated yet. Treat the
whole "Open with" override as the least-proven part of this feature —
revisit with real usage before trusting it's actually complete, rather
than assuming the existing review passes already covered it.

## Known limitation, found and fixed in review (not left in)

The classification logic had two real bugs caught by adversarial review
before any of this shipped:

1. A bare relative path (`notes.txt`) would have silently resolved
   against the Electron main process's own working directory — this
   codebase already has `isAcceptableToolPath()` built for exactly this
   failure mode (used by the VS Code and Terminal steps already); the
   plan originally reinvented weaker logic instead of reusing it. Fixed
   by wiring the schema's `target` field through the same `.refine()`
   pattern those two tools already use — rejected at *save* time, not
   deferred to a restore-time surprise.
2. `new URL("C:\\Users\\...")` parses **successfully** in Node's WHATWG
   URL implementation, with `protocol` set to `"c:"` — without an
   explicit check, a Windows-style path would be wrongly classified as
   an invalid link ("must start with http://") instead of a file path.
   Fixed with a small, platform-agnostic drive-letter check in the
   classifier itself (not Windows platform code — just making the
   classifier correct for a string a mac user could still plausibly
   paste out of habit). Regression-tested directly.

## Found, not fixed (separate, pre-existing, flagged not silently folded in)

While adding real CSS-token backing for the new step's badge color
(`rose`), confirmed the *existing* "App" step's color (`teal`) had
**no CSS backing at all** since it was first added — `step-types.ts`
declared it, but no `--color-tool-teal` variable or `TOOL_BADGE_CLASSES`
entry ever existed, so it silently fell back to a generic zinc badge.
Fixed in the same pass, since it's the identical gap in the identical
system this feature was already touching.

A second, separate pre-existing gap was also found (not fixed, out of
scope): this app's light theme never redefines the Chrome/Spotify badge
colors at all (present in the dark `@theme` block, missing from the
light override) — those two badges silently use dark-tuned colors in
light mode today. Unrelated to anything this feature touches; flagged
for a separate pass.

## New files

- `apps/desktop/src/main/tools/link-tool.ts` — the `linkTool`
  `ToolPlugin`. Classification (`new URL()` parsing, http/https
  allowlist, the Windows-drive-letter guard) lives here, pure and
  platform-agnostic; `run()` dispatches to the platform launcher's new
  `openFileDefault`/`openUrlDefault` (no `appPath`) or the existing
  `openInApp` (appPath set), after an `fs.stat` existence check for the
  file case.
- `apps/desktop/src/main/tools/link-tool.test.ts`.
- `apps/desktop/src/renderer/src/components/step-fields/link-fields.tsx`
  — the `target` field mirrors `vscode-fields.tsx`'s bare
  `<input type="text">` + Browse… pattern; "Open with" starts collapsed
  (a plain text link, not a button) unless already set, mirroring this
  app's existing collapsed-by-default conventions, and reuses
  `app-fields.tsx`'s `handleBrowse`/`window.api.selectApp()` pattern
  directly — not `ResolvedAppPath.tsx`, which is for resolving a
  *known* tool's own detected installs (VS Code, Chrome, ...), not an
  arbitrary user-free app choice.

## Modified files

- `apps/desktop/src/main/platform/types.ts` — `PlatformLauncher` gains
  `openFileDefault(path)`/`openUrlDefault(url)`.
- `apps/desktop/src/main/platform/macos/launcher.ts` — real
  implementation via Electron's `shell.openPath`/`shell.openExternal`.
  `openFileDefault` explicitly checks for `shell.openPath`'s
  documented non-throwing, non-empty-string-means-failure contract —
  confirmed as a real, not hypothetical, risk: a naive try/catch-only
  implementation would silently treat "no handler app installed" as a
  success.
- `apps/desktop/src/main/platform/windows/launcher.ts` — both new
  methods stubbed, matching `openTerminal`'s existing precedent (see
  "Windows stays stubbed" above).
- `apps/desktop/src/main/ipc/handlers.ts` / `preload/index.ts` — new
  `dialog:selectFile` handler (mirrors `dialog:selectApp`'s skeleton,
  no extension filter/defaultPath restriction) and `selectFile` bridge
  method.
- `apps/desktop/src/main/orchestrator/tool-identity.ts` — new `'link'`
  case: only tracked for workspace-activity liveness when an `appPath`
  override is set (a bare file/URL open hands off to whatever the OS
  default is, which isn't something this app launched or can quit).
- `packages/shared/src/step-types.ts` / `error-codes.ts` — the new
  `link` entry (icon `externalLink`, color `rose`) and two new codes,
  `ER-LINK-01` (file no longer exists) / `ER-LINK-02` (open attempt
  itself failed).
- `apps/desktop/src/renderer/src/lib/tool-colors.ts` /
  `styles.css` — real `--color-tool-rose`/`-soft` tokens (light + dark
  tuned), plus the `teal` fix above.
- `apps/desktop/src/renderer/src/components/step-fields/registry.ts` /
  `step-summaries.ts` — the new type's registry entry and one-line
  collapsed-row summary (`<target>, opens with <app>` when an override
  is set).

## Tests

- `link-tool.test.ts` — schema acceptance/rejection (valid http/https,
  absolute and `~`-form paths, a relative path rejected, a non-http(s)
  scheme rejected, the Windows-drive-letter regression specifically
  asserting it fails via the *path* message not the *URL* message),
  `run()` for every combination of {file, url} × {default, appPath
  override}, the missing-file case naming the exact path, the
  `openFileDefault` non-empty-string-is-failure contract, `detail`/
  `expand` with and without an override.
- `macos/launcher.test.ts` — new `shell` mock, covers both new methods'
  success/failure/rejection paths, including the non-empty-string
  regression specifically.
- `windows/launcher.test.ts` — both new methods report the honest stub
  failure, never a silent no-op.
- `tool-identity.test.ts` — the new `'link'` case, with and without
  `appPath`.
- `step-types.test.ts`, `error-codes.test.ts` (already generic, no
  change needed), `step-fields/registry.test.ts`,
  `step-fields/step-summaries.test.ts` — updated/extended for the new
  type.
- No new renderer component tests — matches this repo's established
  precedent.

## Verification

`npm run lint && npm run typecheck && npm run test && npm run build` —
all green (725 tests passing) after the main implementation and again
after the full test suite was updated, not just at the end.

No end-of-feature live Playwright pass — per the founder's standing
instruction, they test directly.
