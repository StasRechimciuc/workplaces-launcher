# Project: Workspace Launcher (placeholder name)

## What This Is

A macOS-first app that lets developers save and restore full "workspaces" with one click: project-specific app sets, terminal commands already running, Docker/Tilt startup, IDE state (VS Code project open), Chrome profile, background apps (e.g. Spotify).

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

GUI-based (not config-file-based), macOS-first, dev-service-orchestration focus (Docker/Tilt/background dev processes as first-class objects, not just windows and env vars). No competitor found combines all three.

## Scope Discipline (do not violate without a real reason)

- **macOS only** for the MVP. Cross-platform (Windows/Linux) is explicitly Phase 2, not now — even though a team member has Linux/VPN background, that capability is deliberately being held back until after validation.
- **No feature creep** into adjacent verticals (design tools, rendering pipelines, etc.) until the core dev use case is validated and working.
- If a new idea or expansion surfaces mid-build, default answer is "not now" unless it's required to ship the core one-click restore flow.

## Code Quality Standard (non-negotiable)

This is being built as a real, sellable SaaS product, not a throwaway prototype — code quality is a product requirement, not polish for later.

- Production-grade code from the first commit: no "fix it later" hacks, no dead/commented-out code left in.
- Consistent conventions across the codebase (naming, file structure, error handling) — follow `architecture.md`'s patterns (platform abstraction, tool registry, standardized step results); don't improvise a one-off shape for a single tool type.
- Security baseline: no secrets/tokens committed or logged, sanitize/validate all input before shelling out (this app runs arbitrary CLI commands and AppleScript — command injection is a real risk here, not theoretical), least-privilege by default.
- No unhandled failure paths — every step that can fail (shell-out, file I/O, missing app) fails loudly with a clear message, never silently.
- If a shortcut is taken to move fast, flag it explicitly rather than let it pass as finished.

## Team & Roles

- **Founder (primary builder) - Stas:** Owns product, design, and full build of the prototype/MVP.
- **Ally (cybersecurity/software background) - Den:** Owns outreach, marketing, and future Linux/VPN/OS-level work (Phase 2). Has a base of established, trusted potential customers. Will present the idea to them once there's something to show. Does not touch the core build in this phase.

## Current Status

- No prototype built yet.
- Immediate task in progress: landing page to use as the validation/pitch asset for the ally's trusted customer base. May include early screenshots/mockups of the prototype once they exist.
- Validation-first approach: get real signal from warm, trusted contacts (via the ally) before or alongside building — NOT cold outreach to strangers (already tried on a prior project, failed due to channel, not idea quality).

## The Pitch / Hook (for landing page and demo)

Lead with the specific restore moment, not a feature list:
"You close your laptop mid-project. Tomorrow, one click — Docker's up, Tilt's running, VS Code has the right project open with terminals already running your dev commands, Chrome's on your work profile, Spotify's on. Zero setup."

Specificity of the pain being removed is what lands — not abstract productivity claims.

## Founder's Known Failure Pattern (context for judgment calls, not for repeating)

Recurring pattern to watch for: when a commitment starts to cost something real, the instinct is to generate an easier, parallel task (extra research, reading, tooling setup, renaming things, expanding scope) and frame it as equally important or as a prerequisite. Tell-tale signs: vague scope, no deadline, framed as "next" or "in addition" rather than being the actual hard task. If a task proposed mid-project matches this pattern, flag it before proceeding.

## Non-Goals For Now

- No cross-platform support yet.
- No pivoting into adjacent tool categories (design, rendering, etc.).
- No building without a name for the validation asset already in motion — naming the project itself is explicitly deprioritized until after the landing page ships.

# Workspace Launcher — Build Shell

## Tier 1 — v1 (build now)

### Core
- [ ] Define workspace config format (JSON)
- [ ] Config holds ordered list of steps
- [ ] Each step: tool type + params
- [ ] macOS app reads config, runs steps in order
- [ ] Simple UI: workspace list + detail (already mocked)

### Step types to support
- [ ] VS Code — open folder path
- [ ] Terminal — open pane(s), run command(s)
- [ ] Docker — run compose/tilt command
- [ ] Chrome — open profile + URLs
- [ ] Spotify — open playlist URI
- [ ] Slack — open channel deep link

### VS Code companion extension
- [ ] Scaffold extension (yo code)
- [ ] Extension reads config on activation
- [ ] Create terminal(s) via `createTerminal()`
- [ ] Run commands via `terminal.sendText()`
- [ ] Position terminals (editor vs panel)

### Orchestrator logic
- [ ] Shell out for CLI tools (Docker, git)
- [ ] `open -a` / AppleScript for GUI apps
- [ ] Sequence steps (wait where needed)
- [ ] Show per-step status (success/fail)
- [ ] Basic retry button per failed step

### Explicitly NOT in v1
- No teardown of previous workspace
- No conflict/port detection
- No k8s context switching
- No parallel workspace support
- No AI-driven decisions — rules only

## Tier 2 — v2 (after v1 validated)

### State tracking
- [ ] Track what's currently running
- [ ] Track active k8s context
- [ ] Track occupied ports

### Teardown
- [ ] Stop containers on switch (`compose down` / `tilt down`)
- [ ] Close/repurpose terminals on switch
- [ ] Reset k8s context if needed

### Conflict handling
- [ ] Check port availability before start
- [ ] Check current k8s context before switch
- [ ] Switch context only if different
- [ ] Fail with clear message, not silently

### UI
- [ ] Real per-step state (running/stopped/failed/needs attention)
- [ ] Manual override / force-stop option

## Tier 3 — vision (not scoped yet)

- [ ] Read machine specs (RAM/CPU/disk)
- [ ] Warn/block if specs can't support parallel run
- [ ] Dynamic port allocation
- [ ] Isolated docker networks per workspace
- [ ] Separate k8s namespaces/contexts concurrently
- [ ] Track N independent process trees, not one

## Rule while building

- Do not touch Tier 2/3 items until Tier 1 ships
- Do not add steps not on this list mid-build
- If a new idea surfaces, write it under Tier 3, move on