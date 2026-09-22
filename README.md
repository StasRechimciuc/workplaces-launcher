# Workspace Launcher

One-click dev environment restore for Windows: Docker/Tilt, VS Code, terminal
commands, Chrome profile, and background apps — restored in order, from a
single saved workspace config. (Platform roadmap: Windows v1 → Linux → macOS
— see `claude.md`.)

See `claude.md` and `docs/` for product/architecture context.

## Structure

```
apps/
  desktop/            Electron app (main/preload/renderer)
  vscode-extension/    Companion VS Code extension
packages/
  shared/              Config schema, step/tool types (types.ts),
                        VS Code restore handoff, atomic file write —
                        shared by both apps
```

See `WCs/WC__project-status.md` for current build status (what's real,
what's tested, what's next) — the canonical, up-to-date snapshot.

## Development

```sh
npm install
npm run dev            # launches the desktop app
```

## Scripts (run from repo root)

```sh
npm run lint            # eslint
npm run format           # prettier --write
npm run typecheck        # tsc --noEmit, per workspace
npm run test              # vitest, across all workspaces
npm run build              # production build, all workspaces
```
