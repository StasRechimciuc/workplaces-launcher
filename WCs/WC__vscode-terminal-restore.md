# VS Code Terminal Restore

How the VS Code companion extension recreates terminal(s)/command(s) when
a workspace is restored — the design behind
`packages/shared/src/vscode-restore.ts` and
`apps/vscode-extension/src/extension.ts`. Source of truth for behavior
is that code; this doc explains _why_ it's shaped the way it is, since
the reasoning (a cross-process handoff with no IPC, versioning, TTL)
isn't obvious from reading either file in isolation.

## What it does

VS Code's own "hot exit" already restores open editor tabs/cursor
position for free. This feature fills the one real gap: recreating
terminal(s) and re-running the dev commands (`npm run dev`, etc.) that
were active — nothing else does that.

A `vscode` step's params optionally include `terminals: [{ commands:
string[] }]` (schema supports N terminals; the v1 UI surfaces exactly
one, mirroring Chrome's `urls` textarea pattern — a second terminal row
is a UI-only addition later if ever wanted, no backend change required).

## The handoff mechanism

No IPC, no shared memory between the Electron main process and the VS
Code extension host — they're separate applications with no direct
channel. Instead: a small JSON file in a shared, independently-computed
app-data directory, keyed by a hash of the target folder's canonicalized
absolute path.

- **One file per folder, not one per restore-id.** Both sides compute
  the exact same hash from the same folder path — a deterministic 1:1
  mapping, no scanning/matching step to get wrong. A second restore of
  the same folder correctly and intentionally overwrites the first
  (last-staged terminals win).
- **`packages/shared/src/write-file-atomic.ts`** — the actual write is
  atomic (temp file + rename), so a crash mid-write can never leave a
  truncated, unparseable handoff file.
- **Path canonicalization is the trickiest part.** The desktop app
  hashes whatever the user typed into the `path` field; the extension
  always hashes `folder.uri.fsPath`, VS Code's own resolved path. On
  win32 these must match despite two independent sources of variance:
  case-insensitivity (`C:\Foo` == `c:\foo`) AND separator style (a
  user-typed `~/projects/x` vs. VS Code's own backslashed report) — both
  are normalized before hashing. Neither normalization applies on
  macOS/Linux, where lowercasing would wrongly conflate two distinct
  real folders and backslash is a valid filename character, not a
  separator. This exact mismatch was a real, shipped bug for one review
  round before being caught and fixed (see `WC__project-status.md`).
- **`path` must be absolute** (or `~`-prefixed, which `expandHome`
  resolves) — `vscode-tool.ts`'s schema rejects anything else via
  `lib/paths.ts`'s `isAcceptableToolPath`. A relative path would hash to
  a different file than the extension's absolute `fsPath` ever will,
  silently breaking the whole feature with no error anywhere.

## Versioning and staleness

- **`CURRENT_VSCODE_RESTORE_VERSION`**, mirroring
  `CURRENT_WORKSPACE_CONFIG_VERSION`'s existing pattern exactly. The
  extension and desktop app ship independently (separate package.json,
  separate release cadence) — an on-disk format skew between producer
  and consumer is a real possibility, not theoretical. A version
  mismatch is diagnosed distinctly from "corrupt": logged, file left in
  place (a future-compatible extension version might still consume it
  within the TTL window), never guess-executed against an unknown shape.
- **5-minute TTL**, checked via `createdAt`. A pending restore older than
  this is silently treated as expired — never fired into a folder opened
  long after the restore attempt that staged it was abandoned (VS Code
  never opened, crashed, user cancelled).
- **Opportunistic sweep** before every write, so a cancelled/crashed
  restore's orphan file doesn't sit on disk forever. The sweep reads
  `createdAt` off the raw parsed JSON rather than requiring full
  current-version schema validity first — otherwise a version-skewed or
  otherwise-malformed file could never be swept even once expired (a
  real bug, fixed one review round after the original TTL logic
  shipped).

## Activation triggers (why three, not one)

The extension's `tryConsumePendingRestore()` is idempotent (a module-
level `isConsuming` re-entrancy guard) and re-runs on:

1. **`onStartupFinished`** — cold start / a fresh window for a folder
   that wasn't already open. Covers the common case.
2. **`onDidChangeWindowState` (focused only, not `active`)** — an
   already-running VS Code doesn't restart its extension host when a
   second launch targets an already-open folder, so `onStartupFinished`
   never fires again for it; refocus is what catches a restore staged
   while it was already running.
3. **Manual "Workspace Launcher: Restore Terminals" command** — covers
   the one gap neither automatic trigger can: a window already open
   _and already focused_ at the exact moment the restore was staged, so
   it never loses+regains focus. `vscode-tool.ts`'s own success message
   tells the user to run this in that situation — an honest, documented
   gap, not a silently missed one.

## Failure handling (all warn, none fail silently)

- **Corrupt file / unsupported version** — `showWarningMessage`, file
  left in place.
- **`createTerminal()` throws** (VS Code documents this can happen in a
  sandboxed/restricted environment) — caught, warned, file left in
  place so the next trigger retries from scratch rather than losing the
  restore.
- **Cleanup delete fails after a successful restore** (e.g. a transient
  Windows file lock from AV/indexing/sync) — caught, warned. Left
  unhandled, this would silently re-run every command a second time on
  the next trigger, since the file would still read back as `'found'`.
- **`openInApp` fails after the restore file was already staged**
  (`vscode-tool.ts`) — the file is cleaned up before returning the
  failure, so a later successful manual open within the TTL window
  can't silently fire commands the step reported as failed.
- **Terminal readiness race** — `terminal.sendText()` immediately after
  `createTerminal()` is a documented VS Code race (a shell that hasn't
  finished initializing can silently drop the first command). Each
  terminal waits for `onDidChangeTerminalShellIntegration`, bounded by a
  3s timeout fallback for a shell without integration support.

## Known, documented limitations (not bugs — out of scope, tracked here)

- **Multi-root VS Code workspaces**: only `workspaceFolders[0]` is ever
  checked. A restore staged for a second/later folder in a multi-root
  workspace is never found.
- **Remote-WSL/SSH/Dev Containers**: the extension host runs on the
  remote machine in these modes, so `process.platform`/`homedir()`
  resolve to the remote filesystem — completely disjoint from where the
  desktop app (on the actual Windows host) wrote the file. The feature
  silently never fires for a remote-dev folder.
- **Windows already-running-app behavior is unverified.** The desktop
  app spawns `Code.exe` directly (`windows/launcher.ts`), relying on VS
  Code's own already-running-instance IPC to honor the target folder —
  architecturally sound reasoning, but real end-to-end Windows testing
  is still blocked on VM access, and the equivalent macOS assumption
  (`open -a` delivering argv to an already-running Chrome) turned out to
  be wrong and needed a real fix. Verify this specifically, first, once
  a Windows VM exists.

## Rejected alternative

A `vscode://` URI-handler-based handoff was considered and rejected —
VS Code's own API docs state a URI is delivered to "the topmost window,"
which is nondeterministic in exactly the multi-window-race scenario this
design needs to get right. The file-based approach isn't a fallback
choice, it's the correct one.

## Explicitly out of scope

- Per-terminal `cwd` override, multiple terminal rows in the UI — the
  schema leaves room for both later without a migration.
- Any feedback loop from the extension back to the Electron app's
  `StepResult` — `sendText()` can't observe whether `npm run dev` itself
  succeeded, and inventing a channel for that would be new architectural
  scope, not "the last unbuilt piece" this feature set out to be.

## Manual test plan (why: `extension.ts` has no unit tests)

`extension.ts` is deliberately not unit-tested — mocking enough of the
real `vscode` API to mean anything needs a heavier harness
(`@vscode/test-electron`) than this thin wiring layer justifies; its
actual logic already lives in, and is tested in,
`packages/shared/src/vscode-restore.ts`. Verified instead via the
Extension Development Host (F5 from `apps/vscode-extension`):

1. Ping command works after the `activationEvents` change (baseline).
2. Cold-start restore: stage a pending file for a fresh folder, open it
   — one Panel terminal appears, commands ran in order.
3. Idempotency: reopen the same folder with nothing newly staged — no
   second terminal (file was deleted after consumption).
4. Already-open-window gap: folder already open, nothing pending —
   stage one, alt-tab away and back — terminal appears without a
   restart.
5. Already-open-and-focused gap: same as above but run "Restore
   Terminals" from the Command Palette instead of alt-tabbing.
6. Corrupt-file handling: hand-write invalid JSON — a warning names the
   file, no terminal, no crash.
7. Expired-file handling: hand-write a valid file with an old
   `createdAt` — silently ignored.
8. The common case: open several ordinary folders with nothing staged —
   zero terminals, zero warnings, ever.
9. Windows-specific (once a VM exists): repeat 2-4 to confirm the real
   `%APPDATA%\Workspace Launcher\vscode-restore\` path and
   case-insensitive canonicalization behave as designed, plus the
   already-running-app check flagged above.
