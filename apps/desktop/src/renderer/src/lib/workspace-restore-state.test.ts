import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import {
  DEFAULT_RESTORE_STATE,
  getWorkspaceRestoreOutcome,
  type WorkspaceRestoreState,
  resultsForSteps,
  withStepResults,
  withStepsChangeOutcome,
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

describe('resultsForSteps', () => {
  const ok = (message: string) => ({ success: true, message, durationMs: 1 });
  const state = {
    restoreResults: [ok('a'), ok('b'), ok('c')],
    stepIdsAtRestore: ['a', 'b', 'c'],
  };

  it('pairs each current step with its own result', () => {
    const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(resultsForSteps(state, steps).map((r) => r.result.message)).toEqual(['a', 'b', 'c']);
  });

  it('drops a removed step’s result instead of leaving a stray entry', () => {
    const steps = [{ id: 'a' }, { id: 'c' }];
    expect(resultsForSteps(state, steps).map((r) => [r.step.id, r.result.message])).toEqual([
      ['a', 'a'],
      ['c', 'c'],
    ]);
  });

  it('follows a reordered step, and leaves a newly added one without a result', () => {
    const steps = [{ id: 'c' }, { id: 'new' }, { id: 'a' }];
    expect(resultsForSteps(state, steps).map((r) => [r.step.id, r.result.message])).toEqual([
      ['c', 'c'],
      ['a', 'a'],
    ]);
  });

  it('is empty with no restore yet', () => {
    expect(
      resultsForSteps({ restoreResults: null, stepIdsAtRestore: null }, [{ id: 'a' }]),
    ).toEqual([]);
  });
});

describe('withStepResults', () => {
  const r = (message: string) => ({ success: true, message, durationMs: 1 });

  it('replaces a re-run step’s result in place and adds a new one', () => {
    const next = withStepResults(
      { restoreResults: [r('a'), r('b')], stepIdsAtRestore: ['a', 'b'] },
      [
        { stepId: 'b', result: r('b2') },
        { stepId: 'c', result: r('c') },
      ],
    );
    expect(next.stepIdsAtRestore).toEqual(['a', 'b', 'c']);
    expect(next.restoreResults?.map((x) => x.message)).toEqual(['a', 'b2', 'c']);
  });

  it('starts fresh when nothing was restored yet', () => {
    expect(
      withStepResults({ restoreResults: null, stepIdsAtRestore: null }, [
        { stepId: 'a', result: r('a') },
      ]),
    ).toEqual({ restoreResults: [r('a')], stepIdsAtRestore: ['a'] });
  });
});

describe('withStepsChangeOutcome', () => {
  const ok = (message: string) => ({ success: true, message, durationMs: 1 });

  it('shows what was closed or left open, and folds in the re-run results', () => {
    const patch = withStepsChangeOutcome(
      {
        ...DEFAULT_RESTORE_STATE,
        applyError: 'old',
        restoreResults: [ok('a')],
        stepIdsAtRestore: ['a'],
      },
      {
        report: {
          closed: ['Terminal (npm run dev)'],
          leftOpen: [{ appName: 'Spotify', reason: 'failed', detail: 'nope' }],
          stepResults: [{ stepId: 'a', result: ok('a again') }],
        },
      },
    );
    expect(patch).toMatchObject({
      applyError: null,
      activityLog: {
        closed: ['Terminal (npm run dev)'],
        leftOpen: [{ appName: 'Spotify', reason: 'failed', detail: 'nope' }],
      },
      restoreResults: [ok('a again')],
      stepIdsAtRestore: ['a'],
    });
  });

  it('leaves the activity log and results alone when nothing happened', () => {
    expect(
      withStepsChangeOutcome(DEFAULT_RESTORE_STATE, {
        report: { closed: [], leftOpen: [], stepResults: [] },
      }),
    ).toEqual({ applyError: null });
  });

  it('records why the apply itself failed, without touching the rest', () => {
    expect(withStepsChangeOutcome(DEFAULT_RESTORE_STATE, { error: 'boom' })).toEqual({
      applyError: 'boom',
    });
  });
});
