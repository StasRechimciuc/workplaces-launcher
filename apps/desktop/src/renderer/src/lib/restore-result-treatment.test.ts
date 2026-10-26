import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@workspace-launcher/shared';
import { getRestoreResultCounts, getRestoreResultTreatment } from './restore-result-treatment';

describe('getRestoreResultTreatment', () => {
  it('returns "success" for a successful result', () => {
    expect(getRestoreResultTreatment({ success: true, message: 'ok', durationMs: 100 })).toBe(
      'success',
    );
  });

  it('returns "skipped" for a code catalog-flagged treatment: skipped', () => {
    expect(
      getRestoreResultTreatment({
        success: false,
        message: 'no plugin',
        durationMs: 0,
        code: ERROR_CODES.TOOL_NOT_FOUND.code,
      }),
    ).toBe('skipped');
  });

  it('returns "failed" for a failure with no code at all', () => {
    expect(getRestoreResultTreatment({ success: false, message: 'oops', durationMs: 0 })).toBe(
      'failed',
    );
  });

  it('returns "failed" for a failure code with no terminal-shaped details', () => {
    expect(
      getRestoreResultTreatment({
        success: false,
        message: 'app not found',
        durationMs: 0,
        code: ERROR_CODES.APP_LAUNCH_FAILED.code,
      }),
    ).toBe('failed');
  });

  it('returns "not-started" when every entry failed before running any command', () => {
    expect(
      getRestoreResultTreatment({
        success: false,
        message: 'never opened',
        durationMs: 0,
        code: ERROR_CODES.TERMINAL_START_FAILED.code,
        details: {
          entries: [
            {
              cwd: '~/x',
              openFailed: { stage: 'open', reason: "couldn't launch Terminal" },
              commands: [{ index: 0, command: 'npm run dev', status: 'not-run' }],
            },
          ],
        },
      }),
    ).toBe('not-started');
  });

  it('returns "started-then-failed" when a command actually ran and failed', () => {
    expect(
      getRestoreResultTreatment({
        success: false,
        message: 'command failed',
        durationMs: 0,
        code: ERROR_CODES.TERMINAL_COMMAND_FAILED.code,
        details: {
          entries: [
            {
              cwd: '~/x',
              commands: [
                { index: 0, command: 'npm run dev', status: 'failed', exitCode: 1, reason: 'boom' },
              ],
            },
          ],
        },
      }),
    ).toBe('started-then-failed');
  });

  it('returns "started-then-failed" when ONE of several entries ran a command, even if another entry never started', () => {
    expect(
      getRestoreResultTreatment({
        success: false,
        message: 'mixed',
        durationMs: 0,
        code: ERROR_CODES.TERMINAL_COMMAND_FAILED.code,
        details: {
          entries: [
            {
              cwd: '~/a',
              openFailed: { stage: 'open', reason: "couldn't launch Terminal" },
              commands: [{ index: 0, command: 'npm i', status: 'not-run' }],
            },
            {
              cwd: '~/b',
              commands: [
                { index: 0, command: 'npm run dev', status: 'failed', exitCode: 1, reason: 'boom' },
              ],
            },
          ],
        },
      }),
    ).toBe('started-then-failed');
  });

  it('(regression) returns "not-started", not "started-then-failed", when one entry fully succeeded and a SIBLING entry never opened', () => {
    expect(
      getRestoreResultTreatment({
        success: false,
        message: 'one card never opened',
        durationMs: 0,
        code: ERROR_CODES.TERMINAL_START_FAILED.code,
        details: {
          entries: [
            {
              cwd: '~/a',
              commands: [{ index: 0, command: 'npm run dev', status: 'success' }],
            },
            {
              cwd: '~/b',
              openFailed: { stage: 'open', reason: "couldn't launch Terminal" },
              commands: [{ index: 0, command: 'npm i', status: 'not-run' }],
            },
          ],
        },
      }),
    ).toBe('not-started');
  });

  it('(regression) never counts a skipped step as "succeeded" via getRestoreResultCounts', () => {
    const results = [
      { success: true, message: 'ok', durationMs: 10 },
      { success: true, message: 'ok', durationMs: 10 },
      {
        success: false,
        message: 'no plugin',
        durationMs: 0,
        code: ERROR_CODES.TOOL_NOT_FOUND.code,
      },
    ];

    expect(getRestoreResultCounts(results)).toEqual({ successCount: 2, failureCount: 0 });
  });

  it('counts a real failure in failureCount, separately from successCount and skipped steps', () => {
    const results = [
      { success: true, message: 'ok', durationMs: 10 },
      {
        success: false,
        message: 'app not found',
        durationMs: 0,
        code: ERROR_CODES.APP_LAUNCH_FAILED.code,
      },
      {
        success: false,
        message: 'no plugin',
        durationMs: 0,
        code: ERROR_CODES.TOOL_NOT_FOUND.code,
      },
    ];

    expect(getRestoreResultCounts(results)).toEqual({ successCount: 1, failureCount: 1 });
  });

  it('degrades to "failed" for malformed/missing details rather than throwing', () => {
    expect(
      getRestoreResultTreatment({
        success: false,
        message: 'weird',
        durationMs: 0,
        code: ERROR_CODES.TERMINAL_START_FAILED.code,
        details: { notEntries: true },
      }),
    ).toBe('failed');
  });
});
