import { describe, expect, it } from 'vitest';
import { isOrchestratorBusy, withOrchestratorBusy } from './orchestrator-busy';

describe('orchestrator-busy', () => {
  it('reports not busy before anything runs', () => {
    expect(isOrchestratorBusy()).toBe(false);
  });

  it('reports busy for the duration of fn, then not busy again', async () => {
    let observedDuring = false;
    await withOrchestratorBusy(async () => {
      observedDuring = isOrchestratorBusy();
    });
    expect(observedDuring).toBe(true);
    expect(isOrchestratorBusy()).toBe(false);
  });

  it('clears the flag even when fn throws', async () => {
    await expect(
      withOrchestratorBusy(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(isOrchestratorBusy()).toBe(false);
  });

  it('stays busy until the SECOND of two overlapping calls finishes, not just the first', async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = withOrchestratorBusy(() => new Promise<void>((r) => (resolveFirst = r)));
    const second = withOrchestratorBusy(() => new Promise<void>((r) => (resolveSecond = r)));

    expect(isOrchestratorBusy()).toBe(true);

    resolveFirst();
    await first;
    // The first call finishing must not clear the flag while the
    // second overlapping call is still in flight.
    expect(isOrchestratorBusy()).toBe(true);

    resolveSecond();
    await second;
    expect(isOrchestratorBusy()).toBe(false);
  });
});
