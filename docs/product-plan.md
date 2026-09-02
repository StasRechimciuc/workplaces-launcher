# Product Plan — Workspace Launcher

## Vision

macOS-first app that lets developers save and restore full dev environments —
apps, terminal commands, Docker/Tilt, browser profile, background apps — with
one click. Wedge vs existing tools (ShiftPlus, PowerToys): dev-specific
service orchestration (Docker/Tilt/dev servers as first-class), not just
window/app restore.

## Competitive Landscape (checked, not a stop condition)

- **ShiftPlus** (macOS, $24-39 lifetime) — closest competitor. Restores apps,
  browser profiles, window layout, terminal env vars. No Docker/Tilt/dev
  service orchestration.
- **PowerToys Workspaces** — same category, Windows only.
- **AgentsRoom** — restores dev servers/terminal state, framed around AI
  coding agents specifically, not general fullstack dev environments.
- **Scripting (tmuxinator, tsm, shell scripts)** — can already do most of
  this for people willing to write/maintain config files. Gap: GUI for
  non-config-writers + dev-service orchestration as first-class.

## The Pitch / Hook

Lead with the specific restore moment, not a feature list:
"You close your laptop mid-project. Tomorrow, one click — Docker's up,
Tilt's running, VS Code has the right project open with terminals already
running your dev commands, Chrome's on your work profile, Spotify's on.
Zero setup."

## Team & Roles

- **Founder:** product, design, full build of prototype/MVP, core engine.
- **Ally (cybersecurity/software background):** outreach, marketing,
  future Linux/VPN/OS-level work (explicitly Phase 2, not now). Has a base
  of trusted potential customers to pitch once there's something to show.

## Feature Decisions

### Approved — Tier 1 (v1)
- Workspace templates/presets (common stacks, e.g. Next.js + Docker + PG)
- Analytics/usage insights (local-only: time saved, most-used workspace,
  restore success/failure history)
- Onboarding wizard for first workspace (guided first-run flow)

### Approved — Paid extension (later)
- AI-assisted config creation (describe setup in plain language → AI
  generates config). Paid add-on, not core — users pay for this, not you.

### Approved — Parked (v2+, after real user demand)
- Team/shared workspaces (lead defines config, team imports/syncs).
  Requires accounts/backend — real complexity jump.
- Menu bar quick-switch (persistent icon, shows active workspace, click to
  switch). "Nice to have," not mandatory for v1.

### Declined
- Cloud sync of configs (too much complexity/backend for now; also removes
  easy path to team sync — accepted tradeoff)
- Marketplace for shared community templates (too complex, needs hosting/
  backend; capped sharing to user/team-only for now)
- Global hotkey to trigger restore (declined, felt unnecessary)
- Export/import config as a file (low value — configs unlikely to be
  reusable across different users' setups)

### Standing Design Principle
- Advanced/future features (team sync, marketplace, etc.) should be
  gated behind an opt-in "extensions" toggle in settings, not built into
  the default/core UI. Keep the core app lean by default.

## OS / Platform — Long-Term Notes

Not in scope for v1 (macOS-only), but documented for later:

- **App control:** macOS uses AppleScript/`open -a`. Windows needs COM
  automation or process spawning. Linux varies by desktop environment
  (no single standard) — hardest to support well.
- **Window management:** macOS Accessibility API; Windows has its own API;
  Linux fragmented (X11 vs Wayland).
- **VS Code extension:** OS-agnostic — same extension API everywhere.
  Low porting cost.
- **Docker/terminal/CLI tools:** near-identical across OSes (just shelling
  out to CLI commands). Low OS-specific complexity.
- **Browser profile switching:** works similarly across OSes via CLI flags.
  Low complexity.
- **Packaging/distribution:** fully OS-specific (.app/notarization,
  .exe/installer, varies for Linux).

Conclusion: hardest OS-specific parts are window management and native app
control. CLI-based pieces (Docker, VS Code, terminal) port over easily.
When cross-platform happens, it's mostly "redo the app-launching layer,"
not a full rewrite — this is why the OS abstraction interface (see
architecture.md) is worth having from day one, at low cost.

## Validation Approach

- Cheap validation first: landing page / interactive mockup, distributed
  through warm channels (ally's trusted contacts), not cold outreach.
  (Cold DMs to strangers already tried on a prior project — failed due to
  channel, not idea quality. Don't repeat that test.)
- Founder is the primary target user — strongest validation signal
  available before external testing; would use this regardless of outside
  demand.
