import { useState } from 'react';
import { appDisplayName } from '@workspace-launcher/shared';
import { Icon } from '../../icons';
import type { StepFieldsProps } from './types';

/**
 * Browse-only, no manual text entry — same "no manual typing" direction
 * as the Chrome/Spotify pickers. Unlike VS Code's project path (a value
 * a dev might reasonably type from memory), a `.app` bundle's exact
 * path isn't something worth typing, so there's no text input here at
 * all, only the native picker (dialog:selectApp).
 */
export function AppFields({ params, onChange }: StepFieldsProps): JSX.Element {
  const path = typeof params['path'] === 'string' ? params['path'] : '';
  const displayName = path ? appDisplayName(path) : '';
  const [isBrowsing, setIsBrowsing] = useState(false);

  async function handleBrowse(): Promise<void> {
    setIsBrowsing(true);
    try {
      const selected = await window.api.selectApp();
      if (selected !== null) {
        onChange({ path: selected });
      }
    } finally {
      setIsBrowsing(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={isBrowsing}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border-strong px-2.5 text-[12.5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-50"
        onClick={() => {
          void handleBrowse();
        }}
      >
        <Icon name="appWindow" size={12} />
        {path ? 'Change app…' : 'Choose app…'}
      </button>
      {displayName && (
        <span className="min-w-0 truncate text-[11.5px] text-text-faint" title={path}>
          {displayName}
        </span>
      )}
    </div>
  );
}
