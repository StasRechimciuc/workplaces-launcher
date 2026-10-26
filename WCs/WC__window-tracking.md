# Per-window tracking + focus-on-request (planned, not started)

Captures what's already been decided about this feature so it survives
the gap between deciding it (2026-10-26) and actually building it
(after the current end-to-end testing pass on everything built since
the Docker tool plugin). Idea-level decided (`/judge` Stage 1
equivalent, done in conversation rather than via agents — the shape
was clear enough not to need them); the concrete technical plan
(Stage 2) has not been run yet. Nothing has been built.

## The motivating bug

Reported directly: "Retry doesn't close old windows — I had two
terminals that failed and it doesn't close them, it just opens two new
ones." Confirmed precisely: Terminal and Docker's Tilt engine (both
via `openTerminal`) duplicate on every call, no window tracking at
all. Chrome also duplicates every call, but deliberately — `-n` is
required for `--profile-directory`/URL args to reach an
already-running Chrome at all (see macos/launcher.ts's own comment).
VS Code does NOT duplicate today, but only incidentally — it's VS
Code's own per-folder idempotency, not anything this app tracks or
controls.

## What already exists today — and its known limit

`WC__workspace-activity.md` already ships a real, working AppleScript
mechanism (`process-control.ts`): `application "X" is running` and
`tell application "X" to quit`, both by app **name**, never a PID
(researched and ruled out there — `open -a` never hands back a usable
PID). That doc's own "Two known v1 limitations" section already names
the gap this feature closes: **VS Code's liveness is app-level, not
per-window** — two open project windows are indistinguishable to it.
This feature is that limitation's actual fix, not a new idea from
scratch.

**Open, unverified question carried into Stage 2:** whether the
EXISTING app-lifecycle Apple Events (`is running`, `quit`) trigger
macOS's Automation/TCC permission prompt in practice. If they don't
(plausible — basic lifecycle Apple Events are commonly exempted), that
tells us nothing about the NEW mechanism this feature needs
(enumerating/closing a SPECIFIC window, e.g. `tell application
"Terminal" to close window N`), which plausibly requires deeper
scripting-dictionary access and very likely DOES prompt. Don't assume
either way — the first concrete step of the real build should verify
this empirically before anything else.

## Decided direction

Real per-window ownership tracking via AppleScript, explicitly
accepting the Automation/TCC permission prompt this likely requires —
not avoided this time, unlike `openTerminal`'s own deliberate choice
to dodge it (see its own comments). This is a conscious reversal of
that earlier tradeoff for this specific feature, not a contradiction
of it: `openTerminal`'s choice was right for "open a terminal and run
a command," where no permission makes sense for something this
routine; "track and selectively close specific windows across
workspaces" cannot be done any other way on macOS.

**Why accepting the prompt is the right call, not just a
compromise:** this aligns with the founder's and the team's existing
longer-term plan — migrating primary platform focus from macOS to
Windows later (per CLAUDE.md's Platform roadmap), and possibly
further out, "the cloud." Real window/process ownership tracking is
infrastructure that migration needs anyway; building it properly now,
accepting the permission cost, is forward-looking rather than a
one-off expedient. A privacy policy page (and whatever else macOS's
own permission-request UI requires) will be built separately,
explaining plainly why the permission is requested — not yet
scheduled, tracked here so it isn't forgotten.

## In scope for this milestone: "focus the window" too

Folded into the SAME feature/build, not a separate one — see the
conversation that settled this: once a specific window can be
addressed at all (the core capability this feature builds), bringing
it to the front is nearly free on top, not independent work. Decided
shape, simple version only:

- No attempt to DETECT "this window needs you" (e.g. a CLI tool
  blocked on an interactive prompt like Claude Code's "trust this
  folder?" Yes/No). Confirmed hard to do reliably: a process blocked
  on stdin and a legitimately long-running, silent process look
  identical from the outside — the exact reasoning `openTerminal`'s
  own near-instant-failure-only detection window is already built on.
- Instead: an always-available "focus this step's window" action,
  unconditional, on any step that opens a window this feature can
  track. The user decides for themselves whether it needs attention;
  the app's only job is making it easy to jump to.

## Explicitly OUT of scope — a separate, later, far-future idea

**True interactive handling** — relaying a blocked prompt into this
app's own UI so the user can answer it without even switching windows
(the deeper version raised in conversation, alongside the simple
"focus" version above). Not happening as part of this milestone.
Reasoning, confirmed in conversation: you cannot safely or generically
parse arbitrary CLI prompts and know how to answer them — a password
prompt, a destructive-action confirmation, and a harmless "trust this
folder?" are indistinguishable from raw output alone, and guessing
wrong has real consequences, not just a bad UX. Doing this for real
would mean a **plugin per interactive tool** (know in advance what a
specific tool's specific prompt looks like and what answers it) —
real, open-ended, security-sensitive work, worth keeping on the list
but judged and built separately, if ever.

## Status

Idea approved. Technical plan not yet written. No code started.
Resume with `/judge` Stage 2 (or re-confirm Stage 1 is still accurate
first, if enough has changed) once the current end-to-end testing pass
is done.
