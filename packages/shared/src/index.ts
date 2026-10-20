export * from './types';
export * from './config-schema';
export * from './step-types';
export * from './error-codes';
export * from './tool-validation';
export * from './restore-progress';
export * from './app-display-name';
export * from './format-duration';
export * from './app-detection';
// spotify.ts and chrome.ts are type-only (no runtime values) — safe
// through this barrel for every consumer, including preload, unlike
// restore-progress.ts's RESTORE_PROGRESS_CHANNEL below: a type-only
// import is fully erased at compile time, so it can never drag in
// config-schema.ts's zod dependency the way a real value import would.
export * from './spotify';
export * from './chrome';

// write-file-atomic.ts and vscode-restore.ts are deliberately NOT
// re-exported here: both use real Node built-ins (node:fs, node:crypto,
// node:os), and this barrel is imported by renderer code too (e.g.
// WorkspaceFormModal.tsx, for types like WorkspaceConfig) — a
// browser-context bundle with no Node polyfills, and this app's
// contextIsolation/nodeIntegration:false security baseline means it
// must never even transitively reach Node-only code. Main-process-only
// and extension-only consumers import them via their own subpath
// exports instead (see package.json's "exports" map):
// '@workspace-launcher/shared/write-file-atomic' and
// '@workspace-launcher/shared/vscode-restore'.
//
// A related, distinct trap: preload/index.ts (sandboxed — see
// main/index.ts's webPreferences) must import restore-progress.ts's
// RESTORE_PROGRESS_CHANNEL via its OWN subpath export
// ('@workspace-launcher/shared/restore-progress'), never through this
// barrel, even though restore-progress.ts itself has no Node
// dependencies. A real (non-type-only) import from this barrel pulls in
// every module it re-exports — including config-schema.ts's `zod`
// import — and Electron's sandboxed preload `require()` cannot resolve
// third-party npm packages the way a normal Node process can. This
// broke the app silently once already: the preload script threw
// "module not found: zod" and never ran contextBridge.exposeInMainWorld,
// leaving `window.api` undefined and the renderer blank.
