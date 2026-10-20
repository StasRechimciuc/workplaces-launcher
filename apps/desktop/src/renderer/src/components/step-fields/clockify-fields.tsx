import type { StepFieldsProps } from './types';
import { ResolvedAppPath } from './ResolvedAppPath';

/**
 * Clockify's only configurable thing, ever — which real installed app
 * this step launches (see ResolvedAppPath's own doc comment for the
 * shared detect/auto-fill/override state machine it shares with
 * vscode/chrome/spotify). Mirrors app-fields.tsx's own minimal-
 * component precedent: no other field exists for this step type — same
 * "genuinely nothing else to configure" reasoning registry.ts's old
 * comment gave for having no entry at all, before this.
 */
export function ClockifyFields({
  params,
  onChange,
  appPathDetection,
}: StepFieldsProps): JSX.Element {
  const appPath = typeof params['appPath'] === 'string' ? params['appPath'] : '';

  return (
    <ResolvedAppPath
      toolLabel="Clockify"
      appPath={appPath}
      onChange={onChange}
      detection={appPathDetection!}
    />
  );
}
