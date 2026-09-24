import { EditableStringList } from '../EditableStringList';
import type { StepFieldsProps } from './types';

/**
 * URLs render via EditableStringList — same reasoning as
 * vscode-fields.tsx's terminal commands: an in-progress empty row is a
 * normal editing state, only surfaced as this tool's own "each url must
 * be a non-empty string" save-time validation error if left blank, not
 * a special case this component needs to handle itself.
 */
export function ChromeFields({
  params,
  onChange,
  registerPrimaryInputRef,
}: StepFieldsProps): JSX.Element {
  const urls = Array.isArray(params['urls'])
    ? params['urls'].filter((u): u is string => typeof u === 'string')
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={registerPrimaryInputRef}
        className="h-8 w-full rounded-sm border border-border-strong bg-bg px-2.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
        type="text"
        placeholder="e.g. Default, Profile 1"
        value={typeof params['profile'] === 'string' ? params['profile'] : ''}
        onChange={(e) => {
          onChange({ profile: e.target.value });
        }}
      />
      <p className="text-[11px] text-text-faint">
        The profile&rsquo;s on-disk directory name (e.g. &quot;Default&quot;, &quot;Profile 1&quot;)
        — not the name shown in Chrome&rsquo;s own UI.
      </p>
      <EditableStringList
        values={urls}
        onChange={(next) => {
          onChange({ urls: next });
        }}
        placeholder="e.g. https://example.com"
        addLabel="Add URL"
        removeAriaLabel="Remove URL"
      />
    </div>
  );
}
