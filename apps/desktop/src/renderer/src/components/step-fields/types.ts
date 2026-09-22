/**
 * Shape every per-tool-type params-form component implements — see
 * registry.ts for the type-keyed lookup that replaces
 * WorkspaceFormModal.tsx's old `if (preset.type === X)` chain.
 */
export interface StepFieldsProps {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  /**
   * Only the row's *primary* field should call this — it's what
   * WorkspaceFormModal.tsx's pendingFocusKeyRef effect focuses once a
   * preset is picked from the Add-tool dropdown. A component with no
   * input simply never calls it; the focus effect's `?.focus()` is
   * already a safe no-op then.
   */
  registerPrimaryInputRef: (el: HTMLInputElement | null) => void;
}

export type StepFieldsComponent = (props: StepFieldsProps) => JSX.Element | null;
