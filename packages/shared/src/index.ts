export * from './types';
export * from './config-schema';
export * from './step-types';
export * from './tool-validation';

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
