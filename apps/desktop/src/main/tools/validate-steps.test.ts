import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolPlugin, WorkspaceStep } from '@workspace-launcher/shared';

// registry.ts holds module-level state — re-import fresh per test via
// vi.resetModules(), same precedent as tools/registry.test.ts.
describe('validateStepsWithRegisteredTools', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeTool(type: string, validate: ToolPlugin['validate']): ToolPlugin {
    return {
      type,
      validate,
      run: async () => ({ success: true, message: 'ok', durationMs: 0 }),
      teardown: async () => ({ success: true, message: 'ok', durationMs: 0 }),
    };
  }

  it('returns null when every step validates, or has no registered tool', async () => {
    const { registerTool } = await import('./registry');
    const { validateStepsWithRegisteredTools } = await import('./validate-steps');
    registerTool(makeTool('good', () => ({ valid: true, data: {} })));

    const steps: WorkspaceStep[] = [
      { type: 'good', params: {} },
      { type: 'nonexistent', params: {} }, // no registered tool — allowed through
    ];
    expect(validateStepsWithRegisteredTools(steps)).toBeNull();
  });

  it('reports the real stepIndex of the first failing step, not just its type', async () => {
    const { registerTool } = await import('./registry');
    const { validateStepsWithRegisteredTools } = await import('./validate-steps');
    registerTool(makeTool('good', () => ({ valid: true, data: {} })));
    registerTool(makeTool('bad', () => ({ valid: false, errors: ['Required'] })));

    const steps: WorkspaceStep[] = [
      { type: 'good', params: {} },
      { type: 'good', params: {} },
      { type: 'bad', params: {} },
    ];
    const result = validateStepsWithRegisteredTools(steps);
    expect(result).toEqual({
      error: 'Invalid params for step type "bad": Required',
      stepIndex: 2,
    });
  });

  it('stops at the FIRST failing step — a later step error never masks an earlier one', async () => {
    const { registerTool } = await import('./registry');
    const { validateStepsWithRegisteredTools } = await import('./validate-steps');
    registerTool(makeTool('bad', () => ({ valid: false, errors: ['first error'] })));

    const steps: WorkspaceStep[] = [
      { type: 'bad', params: {} },
      { type: 'bad', params: {} },
    ];
    expect(validateStepsWithRegisteredTools(steps)?.stepIndex).toBe(0);
  });

  it('forwards fieldErrors through when the tool provided them', async () => {
    const { registerTool } = await import('./registry');
    const { validateStepsWithRegisteredTools } = await import('./validate-steps');
    registerTool(
      makeTool('docker', () => ({
        valid: false,
        errors: ['directory must be a non-empty string'],
        fieldErrors: { directory: 'directory must be a non-empty string' },
      })),
    );

    const result = validateStepsWithRegisteredTools([{ type: 'docker', params: {} }]);
    expect(result?.fieldErrors).toEqual({ directory: 'directory must be a non-empty string' });
  });

  it('omits fieldErrors entirely when the tool did not provide any', async () => {
    const { registerTool } = await import('./registry');
    const { validateStepsWithRegisteredTools } = await import('./validate-steps');
    registerTool(makeTool('bad', () => ({ valid: false, errors: ['whole-object issue'] })));

    const result = validateStepsWithRegisteredTools([{ type: 'bad', params: {} }]);
    expect(result).not.toHaveProperty('fieldErrors');
  });
});
