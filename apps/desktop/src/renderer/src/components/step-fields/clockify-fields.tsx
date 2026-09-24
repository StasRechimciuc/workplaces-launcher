import type { StepFieldsProps } from './types';

/**
 * Clockify has nothing to configure — run() always just opens the
 * desktop app (clockify-tool.ts). This still renders a real row
 * (rather than `null`) so an added Clockify step doesn't look visually
 * identical to an *unimplemented* type's empty row in the Tools list —
 * it's implemented, it just has no fields to fill in. No input, so
 * `registerPrimaryInputRef` is intentionally never called (see
 * step-fields/registry.ts's `hasPrimaryInput: false` for this type).
 */
export function ClockifyFields(_props: StepFieldsProps): JSX.Element {
  return (
    <p className="text-[11.5px] text-text-faint">
      Nothing to configure — this just opens Clockify.
    </p>
  );
}
