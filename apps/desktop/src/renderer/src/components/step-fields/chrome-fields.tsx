import type { StepFieldsProps } from './types';

/**
 * Verbatim move of WorkspaceFormModal.tsx's old 'chrome' StepParamsFields
 * branch — no logic changes, just relocated.
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
      <textarea
        className="min-h-16 w-full resize-y rounded-sm border border-border-strong bg-bg px-2.5 py-1.5 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent-border focus:outline-none"
        placeholder={
          'One URL per line (optional), e.g.\nhttps://example.com\nhttp://localhost:3000'
        }
        value={urls.join('\n')}
        onChange={(e) => {
          const nextUrls = e.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          onChange({ urls: nextUrls });
        }}
      />
    </div>
  );
}
