# Docker project-directory detection — redesign (planned, after window tracking)

Captures decisions settled in conversation (2026-10-28) while testing the
Docker tool plugin, so they survive until this actually gets built. **Queued
behind `WC__window-tracking.md`** — the founder's explicit call: window
tracking is more important and critical, build it first. Idea-level decided
only; no technical plan (`/judge` Stage 2) written yet, nothing built.

## Why this exists

Today's auto-detection (`docker-fields.tsx`) works — correctly found a real
`docker-compose.yml` in a real test project (`_dorpiano-company/darpiano/
darpiano-front`) once a real bug in how it was wired to the draft-vs-saved
directory got fixed (see commit history, 2026-10-28). But confirmed, directly,
during that same testing pass: it's not intuitive or clear as currently
designed. Six specific problems, each with a settled direction below.

## 1. Make it an opt-out setting

A single boolean, on by default, checked before the debounced directory scan
fires at all — same shape as existing settings (`launchOnLogin`,
`defaultTerminalApp`). Cheap, no open questions.

## 2. The Engine (Compose/Tilt) control stays — it's not just a label

Raised: why show an explicit engine toggle at all — can't it be inferred from
the command text? No — `engine` doesn't just describe the command, it picks
the _execution mechanism_ (Compose runs silently in the background; Tilt opens
a real visible Terminal window, via `openTerminal`). Deriving it by sniffing
command text live would let the execution mechanism silently flip mid-edit,
and a custom command (a Makefile target, a wrapper script) has no derivable
engine at all — this is the same class of bug the engine-switch fix (earlier
2026-10-28) already had to fix once, for a different reason.

**What does change:** the toggle shouldn't act like an open 50/50 decision the
user has to actively make when detection already knows the answer with
confidence. It only becomes a real, active decision point when genuinely
ambiguous — both a compose file and a Tiltfile found (see #6, confirmed a
real, not rare, case — the founder's own `_dorpiano-company` project uses
both across different services).

## 3. Ask, don't silently auto-fill

Today: the moment the debounced scan resolves, it silently rewrites the
engine + both command fields (guarded only by "is this field still equal to
some prior default," which is exactly the kind of guard that already caused
one real bug this session). New model:

- Scan finishes → show a clear, dismissible **suggestion** — never written
  into the fields until the user explicitly accepts.
- Exactly one candidate (compose OR tilt) → simple accept/dismiss.
- Multiple candidates (both engines, or multiple nested results from #5) →
  pick-one list, not a silent "Compose's own priority order" pick like today.

**Visual shape — not fully settled, flagged by the founder as likely to
change once built.** Agreed starting point: a compact, anchored
popover/dropdown near the directory field, not a full-page grayed modal —
this is a small per-field decision, not a multi-step flow, and the existing
Docker fields block (engine toggle + two command boxes) already reads as
visually dense; adding a heavier interaction on top risks making that worse,
not better. Revisit the exact presentation once there's something real to
look at.

## 4. No invented trick for genuinely-custom commands

When nothing is found at all, there's no clean way to "ease" manual entry
that isn't either (a) a thin, basically-fake re-implementation of the real
detection logic (a handful of canned command templates), or (b) a real parser
for arbitrary build tooling, which is a different, much bigger problem. Not
pursuing either — explicitly agreed not to ship something flimsy just to have
shipped something here. The real lever for this case is #5: reduce how often
someone hits the dead end at all, rather than inventing a workaround for when
they do.

## 5. Recursive / deeper search

Confirmed valuable, with real scope decisions still needed when this gets
planned: a depth cap (2-3 levels, not unbounded — a large monorepo could make
an uncapped scan slow or noisy), a skip-list for obvious noise (`node_modules`,
`.git`, build output dirs), and a tree-like presentation of multiple nested
candidates so the user can see where each one actually lives relative to the
typed root. When the user picks a nested result, **that becomes the step's
real `directory`** (not the originally-typed root plus a `-f` pointing deep)
— simpler mental model, "project directory" keeps meaning what it says.

## 6. Remember the engine choice — per workspace, with an explicit checkbox

Confirmed real via the founder's own case: the same company's projects mix
engines across services (some via Tilt, some via Compose) — so there's no one
"true" engine per directory to infer or cache globally. Settled shape:

- An explicit **"Remember this choice" checkbox**, not silent/automatic —
  copy must clearly explain what it does and when to leave it off (e.g.
  _"Remember this choice for `<directory>` — turn this off if you switch
  between Compose and Tilt for this project often"_).
- Default reasoning: most projects don't change engine often, so remembering
  is the sensible default _behavior once accepted_ — but the checkbox itself
  should probably default to checked, now asking confirmation rather than
  deciding silently (exact default state not yet locked — small open item for
  the real plan).
- **Scoped per workspace, not a global directory→engine map.** Two different
  workspaces pointing at the same physical folder for different reasons (e.g.
  a "frontend only" workspace and a "full stack" workspace both referencing
  the same monorepo) must never collide or silently override each other's
  remembered choice.

## Status

All six points settled at the idea level, in conversation, during real
end-to-end testing of the Docker tool plugin. Not planned (`/judge` Stage 2
not run), not built. Explicitly **after** `WC__window-tracking.md` in build
order — resume there first.
