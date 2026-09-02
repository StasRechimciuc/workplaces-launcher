# Workspace Launcher

One-click dev environment restore for macOS: Docker/Tilt, VS Code, terminal
commands, Chrome profile, and background apps — restored in order, from a
single saved workspace config.

See `claude.md` and `docs/` for product/architecture context.

## Structure

```
apps/
  desktop/            Electron app (main/preload/renderer)
  vscode-extension/    Companion VS Code extension
packages/
  shared/              Config schema, step-result type, tool-plugin
                        interface — shared by both apps
```

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
