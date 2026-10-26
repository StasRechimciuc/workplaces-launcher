/**
 * Shared save-time field-error styling, matching the one existing
 * precedent for "a control turned red + a message below it" in this
 * codebase (AppHotkeyControl.tsx/WorkspaceHotkeyControl.tsx's hotkey-
 * conflict state, spotify-fields.tsx's own connection-error state) —
 * `border-danger` on the control, a small `text-danger` message
 * immediately below (each field component renders that message line
 * itself — kept out of a shared component so this file stays pure
 * functions, not mixed with a component export, which breaks Fast
 * Refresh per this project's own established precedent). The input's
 * own typed VALUE text deliberately stays the normal text color (not
 * `text-danger`) — only the border and the separate message signal the
 * error, so real typed content never reads as if it were itself the
 * error text.
 */

/** Appends `border-danger` to `baseClassName` when `message` is set —
 * pass straight into an input/control's className. */
export function errorBorderClass(baseClassName: string, message: string | undefined): string {
  return message ? `${baseClassName} border-danger` : baseClassName;
}

/** The standard single-line text input's base className — byte-
 * identical across vscode/link/docker/terminal-fields.tsx before this
 * was extracted, confirmed via direct comparison rather than assumed.
 * Pass as `errorBorderClass`'s first argument (or use directly where a
 * field has no `fieldErrors` support). */
export const PATH_INPUT_CLASS =
  'h-8 min-w-0 flex-1 rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none';
