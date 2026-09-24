---
name: electron-blank-screen
description: Debug "the app doesn't start" / blank or black Workspace Launcher window — especially when the terminal shows no build errors and DevTools won't open or shows nothing. Use whenever the Electron app window is blank/black/unresponsive after a code change.
---

# Debugging a blank/black Electron window

## Why this needs its own procedure

A crash in the **preload script** doesn't show up in the normal places:
- The terminal running `npm run dev` only shows electron-vite's *build* output (main/preload/renderer all "built successfully") — it does not print runtime errors from inside the app.
- The renderer's own DevTools console (Cmd+Option+I) only captures logs from the *page*, not from the preload script that runs before the page's own JS does. If preload throws, `contextBridge.exposeInMainWorld` never runs, `window.api` stays `undefined`, and the very first renderer code that touches `window.api` (e.g. `App.tsx` reading `window.api.platform`) throws immediately — React aborts before painting anything, and DevTools may not even attach to a window that's still in this broken initial state.

Net effect: window opens (native chrome/traffic lights visible), content area stays solid black, DevTools won't open or opens to an empty console, and the terminal looks completely clean. This is the fingerprint of a **preload crash**, not a renderer bug — normal debugging steps won't find it.

## Step 1 — rule out the boring causes first

1. Check the terminal for `npm run dev` — confirm all three build steps ("build the electron main process successfully" / preload / renderer dev server running) actually printed with no errors.
2. Check for a stuck old process holding the single-instance lock or the dev server port, which would make every new launch silently refocus an old broken window instead of starting fresh:
   ```
   ps aux | grep -i "electron-vite\|Electron Helper\|Electron.app" | grep -v grep
   lsof -i :58217   # the renderer dev server port, see electron.vite.config.ts
   ```
   Kill any stale PIDs and restart clean before assuming it's a real bug.

## Step 2 — if it's still blank on a genuinely fresh process, attach CDP directly

1. Add a temporary line at the very top of `apps/desktop/src/main/index.ts` (after the electron import):
   ```ts
   app.commandLine.appendSwitch('remote-debugging-port', '9223');
   ```
2. Restart `npm run dev` fully — main-process changes need a real restart, they don't hot-reload.
3. Run the helper script in this folder (Node 20+, uses native `WebSocket`/`fetch`):
   ```
   node .claude/skills/electron-blank-screen/cdp-console.mjs
   ```
   It connects to `localhost:9223`, finds the app's page target, forces a reload, and dumps every console message and uncaught exception — including ones from *before* the page's own script would normally have a chance to log anything.
4. Read the output. A preload crash looks like:
   ```
   console.error: "Unable to load preload script: .../out/preload/index.js"
   console.error: "Error: module not found: <package>"
   ```
   followed by a renderer exception on whatever first touches `window.api`.
5. **Remove the `appendSwitch` line once you're done** — it's debug-only, never commit it.

## Known root cause in this codebase: a barrel import dragging a dependency into sandboxed preload

`apps/desktop/src/preload/index.ts` runs **sandboxed** (`sandbox: true`, `main/index.ts`). Its `require()` is Electron's restricted preload loader, not real Node module resolution — it can only use whatever the bundler actually inlined.

`packages/shared/src/index.ts` is a barrel (`export * from './config-schema'`, etc.). `config-schema.ts` imports `zod`. If preload imports **any real (non-type-only) value** from the bare `@workspace-launcher/shared` specifier, the bundler pulls in the *whole barrel* to bundle it — including `config-schema.ts` — and since only the bare package name (not its dependencies) is excluded from `externalizeDepsPlugin` in `electron.vite.config.ts`, `zod` gets left as an external `require("zod")` that the sandboxed preload cannot resolve. Preload throws on load, `window.api` is never set, and the renderer crashes blank.

**Fix pattern** (already used for `vscode-restore.ts` and `write-file-atomic.ts`, same reasoning): give the value its own subpath export in `packages/shared/package.json`'s `"exports"` map, and import it from that subpath in `preload/index.ts` instead of the bare package specifier. This bundles only that one small file, not the whole barrel. Check the built output to confirm:
```
cat apps/desktop/out/preload/index.js
```
It should only ever `require("electron")` — any other `require(...)` of a third-party package there is the same bug recurring.

## Verification after any fix

```
npm run lint && npm run typecheck && npm run test && npm run build
cat apps/desktop/out/preload/index.js   # confirm no stray require() of a third-party package
```
Then restart `npm run dev` and confirm the window actually shows the sidebar/workspace list.
