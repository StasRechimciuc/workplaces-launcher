/**
 * Result of running a single workspace step, regardless of tool type.
 * Every tool plugin's `run()` returns exactly this shape — see
 * docs/architecture.md #4 ("Standardized Step Result Shape"). Keeping
 * this identical across every tool type is what makes the retry/status
 * UI work the same way for Docker, VS Code, Chrome, etc. instead of
 * special-casing each one.
 */
export interface StepResult {
  success: boolean;
  message: string;
  durationMs: number;
}
