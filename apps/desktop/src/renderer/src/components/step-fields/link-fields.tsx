import { useState } from 'react';
import { appDisplayName } from '@workspace-launcher/shared';
import { Icon } from '../../icons';
import type { StepFieldsProps } from './types';

/**
 * One field, auto-detecting file vs. link — no upfront "which kind is
 * this?" choice (see WCs/WC__file-or-link.md: Raycast's Quicklinks
 * pattern, the clearest real-world precedent found for this). Browse…
 * fills the field with an absolute path via the native file picker
 * (dialog:selectFile); typing/pasting a link works directly in the
 * same input. Classification itself happens in the main process
 * (tools/link-tool.ts), not here — this component never needs to know
 * which one the user meant.
 *
 * "Open with a specific app" starts collapsed (a plain text link, not
 * a button) unless already set — most steps won't use it, same
 * collapsed-by-default precedent as VS Code's optional terminal
 * commands.
 */
export function LinkFields({
  params,
  onChange,
  registerPrimaryInputRef,
}: StepFieldsProps): JSX.Element {
  const target = typeof params['target'] === 'string' ? params['target'] : '';
  const appPath = typeof params['appPath'] === 'string' ? params['appPath'] : '';
  const appDisplay = appPath ? appDisplayName(appPath) : '';
  const [isBrowsingFile, setIsBrowsingFile] = useState(false);
  const [isBrowsingApp, setIsBrowsingApp] = useState(false);
  const [openWithExpanded, setOpenWithExpanded] = useState(appPath.length > 0);

  async function handleBrowseFile(): Promise<void> {
    setIsBrowsingFile(true);
    try {
      const selected = await window.api.selectFile();
      if (selected !== null) {
        onChange({ target: selected });
      }
    } finally {
      setIsBrowsingFile(false);
    }
  }

  async function handleBrowseApp(): Promise<void> {
    setIsBrowsingApp(true);
    try {
      const selected = await window.api.selectApp();
      if (selected !== null) {
        onChange({ appPath: selected });
      }
    } finally {
      setIsBrowsingApp(false);
    }
  }

  function handleUseDefault(): void {
    onChange({ appPath: undefined });
    setOpenWithExpanded(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          ref={registerPrimaryInputRef}
          className="h-8 min-w-0 flex-1 rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
          type="text"
          placeholder="Paste a link, or browse to a file…"
          value={target}
          onChange={(e) => {
            onChange({ target: e.target.value });
          }}
        />
        <button
          type="button"
          disabled={isBrowsingFile}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.5 text-[12.5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            void handleBrowseFile();
          }}
        >
          <Icon name="folder" size={12} />
          Browse…
        </button>
      </div>

      {openWithExpanded ? (
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[11.5px] text-text-faint">Open with:</span>
          <button
            type="button"
            disabled={isBrowsingApp}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.5 text-[11.5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
            onClick={() => {
              void handleBrowseApp();
            }}
          >
            <Icon name="appWindow" size={11} />
            {appPath ? 'Change app…' : 'Choose app…'}
          </button>
          {appDisplay && (
            <span className="min-w-0 truncate text-[11.5px] text-text-faint" title={appPath}>
              {appDisplay}
            </span>
          )}
          <button
            type="button"
            className="shrink-0 text-text-faint hover:text-danger"
            onClick={handleUseDefault}
            title="Use the default app instead"
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="w-fit text-[11px] text-text-faint hover:text-text-muted"
          onClick={() => {
            setOpenWithExpanded(true);
          }}
        >
          Open with a specific app…
        </button>
      )}
    </div>
  );
}
