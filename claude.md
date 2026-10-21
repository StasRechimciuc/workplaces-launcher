# Project: Workspace Launcher (placeholder name)

## What This Is

An app that lets developers save and restore full "workspaces" with one click: project-specific app sets, terminal commands already running, Docker/Tilt startup, IDE state (VS Code project open), Chrome profile, background apps (e.g. Spotify).

**Platform roadmap (updated 2026-10-21): macOS is primary for now.** History: originally macOS-first; reversed to Windows-first on 2026-09-07 (macOS's AppleScript/TCC-permission surface was judged the harder, slower path to a validated end-to-end restore flow); then blocked on 2026-09-17 by having no Windows VM/virtualizer, with macOS work explicitly framed at the time as *filler only, not a reversion*. Founder's call on 2026-10-21: drop that "filler" framing — macOS is now the real, primary focus, full stop, until the founder's own daily machine switches to Windows (not just "until a VM exists," which was the old bar). Windows and Linux both stay deferred, not dropped, until then; the Windows platform layer already built (`apps/desktop/src/main/platform/windows/`) stays as-is, untouched, not actively worked. See "Scope Discipline" below.

## Core Pain Being Solved

Devs lose 10-30+ min every session rebuilding their environment: reopening Docker, Tilt, VS Code, the right Chrome profile, retyping terminal commands (`npm run dev`, `node start`, etc). This is a personal, firsthand pain — the founder is the primary target user, which is the strongest validation signal available before external testing.

## Docs related to the project identity/ideas/plans:
- ~/docs/*

## Competitive Landscape (already researched, do not treat as "someone did it, stop")

- **ShiftPlus** (macOS, $24-39 lifetime) — closest competitor. Restores apps, browser profiles (10 browsers), window layout, terminal env vars, Spaces. Does NOT do dev service orchestration — no Docker/Tilt/dev-server process management.
- **PowerToys Workspaces** — same category, Windows only.
- **AgentsRoom** — restores dev servers/terminal sessions, but framed specifically around AI coding agent sessions, not general fullstack dev environments.
- **Scripting (tmuxinator, tsm, shell scripts)** — can already do most of this for people willing to write/maintain config files manually. The real gap: no GUI-based tool for non-config-writing devs that also treats Docker/Tilt/dev servers as first-class restorable state.

## The Wedge / Differentiation

GUI-based (not config-file-based), dev-service-orchestration focus (Docker/Tilt/background dev processes as first-class objects, not just windows and env vars). No competitor found combines all three. Note: PowerToys Workspaces is Windows-only, so it isn't a direct competitor on macOS right now — but it's the same category and will be once Windows work resumes; the dev-service-orchestration gap (no Docker/Tilt/dev-server management) is the real differentiator against it either way, not the platform choice.

## Scope Discipline (do not violate without a real reason)

- **macOS is primary for now** (reversed 2026-10-21 — see Platform roadmap above) — full end-to-end restore flow (config → orchestrator → tool steps → real apps/processes) working on macOS is what "v1 done" means right now. **Windows** resumes as primary once the founder's own daily machine switches to it — not dropped, just paused. **Linux** stays after that (a team member already has Linux/VPN background and owns this).
- Do not build platform code for more than one OS at a time. macOS-only until the founder switches to Windows; only then does Windows work resume, followed by Linux.
- **Desktop-only layout, no phone/tablet responsive design.** This is a native desktop app, not a website — there is no mobile context to design for. Build and test against a minimum window width of 1200px; don't spend effort on narrow-viewport/touch layouts.
- **No feature creep** into adjacent verticals (design tools, rendering pipelines, etc.) until the core dev use case is validated and working.
- If a new idea or expansion surfaces mid-build, default answer is "not now" unless it's required to ship the core one-click restore flow.

## Code Quality Standard (non-negotiable)

This is being built as a real, sellable SaaS product, not a throwaway prototype — code quality is a product requirement, not polish for later.

- Production-grade code from the first commit: no "fix it later" hacks, no dead/commented-out code left in.
- Consistent conventions across the codebase (naming, file structure, error handling) — follow `architecture.md`'s patterns (platform abstraction, tool registry, standardized step results); don't improvise a one-off shape for a single tool type.
- Security baseline: no secrets/tokens committed or logged, sanitize/validate all input before shelling out (this app runs arbitrary CLI commands and shell/PowerShell invocations — command injection is a real risk here, not theoretical), least-privilege by default.
- No unhandled failure paths — every step that can fail (shell-out, file I/O, missing app) fails loudly with a clear message, never silently.
- If a shortcut is taken to move fast, flag it explicitly rather than let it pass as finished.

## Team & Roles

- **Founder (primary builder) - Stas:** Owns product, design, and full build of the prototype/MVP.
- **Ally (cybersecurity/software background) - Den:** Owns outreach, marketing, and the Linux/VPN/OS-level port (after macOS, then Windows — see Platform roadmap above). Has a base of established, trusted potential customers. Will present the idea to them once there's something to show. Does not touch the core build.

## Current Status

**A working prototype now exists.** This section intentionally stays a short pointer, not a running log — `WCs/WC__project-status.md` is the single source of truth for current build status (what's real/tested/verified, known gaps, next steps); read that for the actual state and keep it, not this section, updated day to day. `docs/build-shell.md` is the single source of truth for the Tier 1/2/3 scope checklist — it used to be duplicated into this file too, which silently drifted out of sync; don't recreate that duplicate.

Summary as of the last check there: real workspace persistence + full CRUD (create/edit/delete), four working tool plugins (VS Code, Chrome, Spotify, Clockify — each now with real app-location detection, not a hardcoded name guess), a working Windows platform layer built and unit-tested but currently paused, not actively worked (see Platform roadmap above), and a working VS Code companion extension that restores terminal commands on workspace restore.

- Validation-first approach unchanged: get real signal from warm, trusted contacts (via the ally) before or alongside building — NOT cold outreach to strangers (already tried on a prior project, failed due to channel, not idea quality).
- The landing page (the validation/pitch asset for the ally's trusted customer base) can now use real screenshots of the actual prototype instead of early mockups.

## The Pitch / Hook (for landing page and demo)

Lead with the specific restore moment, not a feature list:
"You close your laptop mid-project. Tomorrow, one click — Docker's up, Tilt's running, VS Code has the right project open with terminals already running your dev commands, Chrome's on your work profile, Spotify's on. Zero setup."

Specificity of the pain being removed is what lands — not abstract productivity claims.

## Founder's Known Failure Pattern (context for judgment calls, not for repeating)

Recurring pattern to watch for: when a commitment starts to cost something real, the instinct is to generate an easier, parallel task (extra research, reading, tooling setup, renaming things, expanding scope) and frame it as equally important or as a prerequisite. Tell-tale signs: vague scope, no deadline, framed as "next" or "in addition" rather than being the actual hard task. If a task proposed mid-project matches this pattern, flag it before proceeding.

## Non-Goals For Now

- No active Windows or Linux work until the founder's daily machine switches to Windows (see Platform roadmap above).
- No pivoting into adjacent tool categories (design, rendering, etc.).
- No building without a name for the validation asset already in motion — naming the project itself is explicitly deprioritized until after the landing page ships.
