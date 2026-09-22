import type { StepFieldsProps } from './types';

/**
 * Verbatim move of WorkspaceFormModal.tsx's old 'spotify' StepParamsFields
 * branch — no logic changes, just relocated.
 */
export function SpotifyFields({
  params,
  onChange,
  registerPrimaryInputRef,
}: StepFieldsProps): JSX.Element {
  return (
    <input
      ref={registerPrimaryInputRef}
      className="h-8 w-full rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
      type="text"
      placeholder="Optional — spotify:playlist:... or https://open.spotify.com/playlist/..."
      value={typeof params['playlist'] === 'string' ? params['playlist'] : ''}
      onChange={(e) => {
        onChange({ playlist: e.target.value });
      }}
    />
  );
}
