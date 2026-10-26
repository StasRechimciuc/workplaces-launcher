import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import {
  DEFAULT_RESTORE_STATE,
  getWorkspaceRestoreOutcome,
  type WorkspaceRestoreState,
} from './workspace-restore-state';

function withResults(results: WorkspaceRestoreState['restoreResults']): WorkspaceRestoreState {
  return { ...DEFAULT_RESTORE_STATE, restoreResults: results };
}

describe('getWorkspaceRestoreOutcome', () => {
  it('returns "none" for a workspace with no restore state at all', () => {
    expect(getWorkspaceRestoreOutcome(undefined)).toBe('none');
  });

  it('returns "none" for the default (never-restored) state', () => {
    expect(getWorkspaceRestoreOutcome(DEFAULT_RESTORE_STATE)).toBe('none');
  });

  it('returns "success" when every step succeeded', () => {
    const state = withResults([
      { success: true, message: 'ok', durationMs: 10 },
      { success: true, message: 'ok', durationMs: 10 },
    ]);
    expect(getWorkspaceRestoreOutcome(state)).toBe('success');
  });

  it('returns "failed" when every real step failed (no successes at all)', () => {
    const state = withResults([
      { success: false, message: 'boom', durationMs: 0, code: ERROR_CODES.APP_LAUNCH_FAILED.code },
    ]);
    expect(getWorkspaceRestoreOutcome(state)).toBe('failed');
  });

  it('returns "partial" when at least one step succeeded AND at least one genuinely failed', () => {
    const state = withResults([
      { success: true, message: 'ok', durationMs: 10 },
      { success: false, message: 'boom', durationMs: 0, code: ERROR_CODES.APP_LAUNCH_FAILED.code },
    ]);
    expect(getWorkspaceRestoreOutcome(state)).toBe('partial');
  });

  it('returns "success", not "partial", when a skipped step sits alongside real successes (skipped is neither)', () => {
    const state = withResults([
      { success: true, message: 'ok', durationMs: 10 },
      {
        success: false,
        message: 'no plugin',
        durationMs: 0,
        code: ERROR_CODES.TOOL_NOT_FOUND.code,
      },
    ]);
    expect(getWorkspaceRestoreOutcome(state)).toBe('success');
  });

  it('(regression) returns "none", not "success", when every step was skipped', () => {
    const state = withResults([
      {
        success: false,
        message: 'no plugin',
        durationMs: 0,
        code: ERROR_CODES.TOOL_NOT_FOUND.code,
      },
    ]);
    expect(getWorkspaceRestoreOutcome(state)).toBe('none');
  });

  it('(regression) returns "none" for an empty results array, not "success"', () => {
    expect(getWorkspaceRestoreOutcome(withResults([]))).toBe('none');
  });
});
