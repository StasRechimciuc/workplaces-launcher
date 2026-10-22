/**
 * One-directional main -> renderer push telling the renderer "the
 * 'Save current workspace' hotkey fired, open the review screen" —
 * mirrors restore-progress.ts's RESTORE_PROGRESS_CHANNEL precedent
 * exactly (own subpath export, not the barrel — preload imports real
 * values from here, and the barrel would drag zod into its sandboxed
 * require(), see that file's own doc comment and packages/shared/
 * src/index.ts).
 *
 * No payload: the renderer calls window.api.detectCurrentWorkspace()
 * itself once it reacts to this, rather than the push carrying the
 * (possibly large, main-process-only-computed) draft directly.
 */
export const SAVE_CURRENT_WORKSPACE_TRIGGERED_CHANNEL = 'workspaces:save-current-triggered';
